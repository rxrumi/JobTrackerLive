import assert from "node:assert/strict";
import test from "node:test";
import worker, { runScan, scanSourceInventory, ScanCoordinator } from "../src/worker.js";
import { processAccountDeletion } from "../src/account-lifecycle.js";
import { handleOneClickUnsubscribe, handleResumeStudioRequest, runDailyResumeMatching } from "../src/resume-studio.js";

const date = () => new Date().toISOString().slice(0, 10);
function kv(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, async get(key) { return structuredClone(values.get(key) || null); },
    async put(key, value) { values.set(key, JSON.parse(value)); } };
}

test("health reports unavailable, old, partial and unpublished feeds truthfully", async () => {
  for (const [jobs, status, code] of [
    [null, "unavailable", 503],
    [{ last_scan: "2000-01-01" }, "degraded", 503],
    [{ last_scan: date(), scan_meta: { partialCount: 1 } }, "degraded", 200],
    [{ last_scan: date(), scan_cycle: { publication_complete: false } }, "degraded", 503],
    [{ last_scan: date() }, "ok", 200]
  ]) {
    const result = await worker.fetch(new Request("https://example.com/api/status"), { KV: kv({ jobs }) });
    assert.equal(result.status, code);
    assert.equal((await result.json()).status, status);
  }
  const result = await worker.fetch(new Request("https://example.com/api/status"), { KV: { async get() { throw Error("offline"); } } });
  assert.equal(result.status, 503);
});

test("account deletion without Clerk credentials retries before deleting data", async () => {
  const writes = [];
  const DB = { prepare(sql) { return { bind(...args) { this.args = args; return this; },
    async first() { return { id: "request", user_id: "synthetic-user", status: "pending", source: "user" }; },
    async run() { writes.push({ sql, args: this.args }); } }; } };
  await assert.rejects(processAccountDeletion({ DB }, "request"), /clerk_credentials_missing/);
  assert.equal(writes.some(item => /delete from/.test(item.sql)), false);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /status = 'retrying'/);
});

test("old scan dates never fetch or write today's content", async () => {
  const KV = kv();
  assert.equal((await runScan({ KV }, { scanDate: "2000-01-01" })).error, "expired_scan_date");
  assert.equal(KV.values.size, 0);
  let ack = false;
  await worker.queue({ messages: [{ body: { type: "scan_retry", scan_date: "2000-01-01" }, ack() { ack = true; } }] }, {});
  assert.equal(ack, true);
});

test("completed scan replay performs no source fetch or checkpoint writes", async t => {
  t.mock.method(globalThis, "fetch", () => { throw Error("unexpected upstream request"); });
  const sourceMeta = Object.fromEntries(scanSourceInventory().map(s => [s.id, { status: "complete" }]));
  const state = { postings: {}, scan_cycle: { date: date(), complete: true, publication_complete: true, completed_shards: [0,1,2,3,4] }, scan_meta: { sourceMeta } };
  const KV = kv({ state });
  const result = await runScan({ KV });
  assert.equal(result.replay, true);
  assert.equal(KV.values.size, 1);
  const entries = new Map();
  const storage = { async get(k) { return entries.get(k); }, async put(k,v) { entries.set(k,v); }, async delete(k) { entries.delete(k); } };
  const coordinator = new ScanCoordinator({ storage }, { KV });
  const response = await coordinator.fetch(new Request("https://internal/run", { method: "POST", body: JSON.stringify({ scanDate: date(), shardIndex: 0 }) }));
  assert.equal((await response.json()).skipped, true);
});

test("a 13 MiB OpenAI board fits its bounded source-specific limit", async t => {
  const body = JSON.stringify({ jobs: [{ id: "large", title: "Software Engineer", location: "Dublin, Ireland", jobUrl: "https://example.com/job" }], padding: " ".repeat(13 * 1024 * 1024) });
  t.mock.method(globalThis, "fetch", async url => {
    if (String(url).includes("job-board/openai")) return new Response(body);
    return Response.json({ jobs: [], postings: [], results: [], total: 0 });
  });
  const result = await runScan({ KV: kv() }, { shardIndex: 1 });
  assert.equal(result.error, undefined);
  assert.equal(result.next.scan_meta.sourceMeta["ashby-openai"].retainedJobs, 1);
});

test("oversized JSON has a distinct diagnostic and failed roles expire without being called closed", async t => {
  t.mock.method(globalThis, "fetch", async url => String(url).includes("job-board/openai")
    ? new Response("{}", { headers: { "content-length": String(21 * 1024 * 1024) } })
    : Response.json({ jobs: [] }));
  const stale = { id: "ashby-openai-old", source: "ashby", source_token: "openai", last_seen: "2000-01-01", first_seen: "2000-01-01", last_filled: null };
  const KV = kv({ state: { postings: { [stale.id]: stale } } });
  const result = await runScan({ KV }, { shardIndex: 1 });
  assert.equal(result.next.scan_meta.sourceMeta["ashby-openai"].lastFailure.reason, "response_too_large");
  assert.equal(result.next.postings[stale.id], undefined);
  assert.equal(stale.last_filled, null);
});

test("unknown routes return 404 and public job pages omit unsupported schema claims", async () => {
  assert.equal((await worker.fetch(new Request("https://example.com/nonexistent-audit-page"), {})).status, 404);
  const DB = { prepare() { return { bind() { return this; }, async first() { return { id: "example", title: "Engineer", company: "Example", last_seen_date: "2000-01-01", first_seen_date: "2000-01-01" }; } }; } };
  const response = await worker.fetch(new Request("https://example.com/jobs/example/engineer"), { DB });
  const html = await response.text();
  assert.match(html, /current availability unconfirmed/);
  assert.doesNotMatch(html, /validThrough|employmentType|Confirmed live posting/);
});

test("unsubscribe GET confirms without changing settings; signed POST updates them", async () => {
  const env = { UNSUBSCRIBE_SECRET: "synthetic-test-key" };
  const payload = Buffer.from(JSON.stringify({ user_id: "synthetic-user", exp: Math.floor(Date.now()/1000) + 1000 })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.UNSUBSCRIBE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url");
  const url = `https://example.com/api/email/unsubscribe?token=${payload}.${signature}`;
  let writes = 0;
  const deps = { async run() { writes++; } };
  const get = await handleOneClickUnsubscribe(new Request(url), env, deps);
  assert.equal(get.status, 200);
  assert.match(await get.text(), /form method="post"/);
  assert.equal(get.headers.get("referrer-policy"), "no-referrer");
  assert.equal(writes, 0);
  assert.equal((await handleOneClickUnsubscribe(new Request(url, { method: "POST" }), env, deps)).status, 200);
  assert.equal(writes, 1);
});

test("matching skips empty rules before reading jobs and single-job queries use equality", async () => {
  const queries = [];
  const env = { RESUME_DAILY_MATCHING_ENABLED: "true" };
  await runDailyResumeMatching(env, { async all(sqlEnv, sql) { queries.push(sql); return []; } });
  assert.equal(queries.length, 1);
  await runDailyResumeMatching(env, { async all(sqlEnv, sql) { queries.push(sql); return sql.includes("build_rules") ? [{ id: "example" }] : []; }, async first() { return null; } }, date(), null, "example-job");
  assert.match(queries.at(-1), /and p.id = \?/);
  assert.doesNotMatch(queries.at(-1), /is null or/);
});

test("production status reads publication metadata without loading the feed body", async () => {
  let bodyReads = 0;
  const DB = { prepare(sql) { return { bind() { return this; }, async first() {
    return sql.includes("feed_pointer") ? { last_scan: date(), last_scan_at: new Date().toISOString(),
      feed_version: "fixture-version", r2_key: "fixture-feed", active_jobs: 42, partial_count: 1, fail_count: 0 }
      : { scan_date: date(), status: "degraded" };
  } }; } };
  const JOB_FEEDS = { async head() { return { size: 6000000 }; }, async get() { bodyReads++; throw Error("body read"); } };
  const response = await worker.fetch(new Request("https://example.com/api/status"), { DB, JOB_FEEDS });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.active_jobs, 42);
  assert.equal(payload.status, "degraded");
  assert.equal(bodyReads, 0);
});

test("permanent upstream configuration failures do not enqueue retries", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("missing board", { status: 404 }));
  const result = await runScan({ KV: kv() }, { shardIndex: 0 });
  assert.equal(result.retryable, false);
  let queued = 0;
  await worker.scheduled({ cron: "0 3 * * *" }, { KV: kv(), RESUME_QUEUE: { async send() { queued++; } } });
  assert.equal(queued, 0);
});

test("a shard retry fetches only sources that failed on its first attempt", async t => {
  const calls = new Map();
  t.mock.method(globalThis, "fetch", async url => {
    const href = String(url);
    const count = (calls.get(href) || 0) + 1;
    calls.set(href, count);
    return href.includes("hubspotjobs") && count === 1 ? new Response("transient", { status: 503 }) : Response.json({ jobs: [] });
  });
  const KV = kv();
  assert.equal((await runScan({ KV }, { shardIndex: 0 })).failCount, 1);
  const result = await runScan({ KV }, { shardIndex: 0 });
  assert.equal(result.failCount, 0);
  assert.equal(result.next.scan_meta.failCount, 0);
  for (const [url, count] of calls) assert.equal(count, url.includes("hubspotjobs") ? 2 : 1);
});

test("resume upload removes its object if metadata persistence fails", async () => {
  const objects = new Set();
  const env = { RESUME_STUDIO_ALLOWED_USERS: "synthetic-user", RESUME_FILES: {
    async put(key) { objects.add(key); }, async delete(key) { objects.delete(key); }
  } };
  const deps = {
    async first(env, sql) { return sql.includes("account_type") ? { account_type: "individual" } : null; },
    async run(env, sql) { if (sql.includes("insert into resume_sources")) throw Error("synthetic D1 outage"); }
  };
  const request = new Request("https://example.com/api/resume-sources", { method: "POST",
    headers: { "content-type": "application/pdf", "x-filename": "synthetic.pdf" }, body: "%PDF-synthetic-fixture" });
  await assert.rejects(handleResumeStudioRequest(request, env, null, { id: "synthetic-user", email: "fixture@example.com" }, deps), /synthetic D1 outage/);
  assert.equal(objects.size, 0);
});

test("build dispatch failure keeps its durable reservation and exposes pending dispatch", async () => {
  const writes = [];
  let buildId;
  const deps = {
    async first(env, sql) {
      if (sql.includes("account_type")) return { account_type: "individual" };
      if (sql.includes("from entitlement_grants")) return { id: "grant" };
      if (sql.includes("from resume_profiles")) return { id: "profile" };
      if (sql.includes("select id, is_active")) return { id: "job", is_active: 1, updated_at: "fixture" };
      if (sql.includes("from usage_reservations")) return { id: "reservation", status: "reserved" };
      if (sql.includes("from ai_daily_budgets")) return { accepted_builds: 1, estimated_cost_usd: 0 };
      if (sql.includes("select id from resume_builds")) return buildId ? { id: buildId } : null;
      return null;
    },
    async run(env, sql, ...params) { writes.push(sql); if (sql.includes("insert into resume_builds")) buildId = params[0]; return { meta: { changes: 1 } }; }
  };
  const request = new Request("https://example.com/api/jobs/job/application-pack", { method: "POST", body: JSON.stringify({ profile_id: "profile" }) });
  const result = await handleResumeStudioRequest(request, { RESUME_STUDIO_ALLOWED_USERS: "synthetic-user",
    RESUME_QUEUE: { async send() { throw Error("synthetic queue outage"); } } }, null,
  { id: "synthetic-user", email: "fixture@example.com" }, deps);
  assert.equal(result.status, 202);
  assert.equal((await result.json()).dispatch_pending, true);
  assert.equal(writes.some(sql => sql.includes("build_creation_failed")), false);
});
