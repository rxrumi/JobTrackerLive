import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { persistScanToD1 } from "../src/worker.js";
import { runResumeMaintenance } from "../src/resume-studio.js";
import { runScanStorageMaintenance, SNAPSHOT_CLEANUP_BATCH } from "../src/scan-storage.js";

function literal(value) {
  return value == null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
}

function sqliteFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "jobtracker-persistence-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, "fixture.db");
  const execute = sql => execFileSync("sqlite3", [database], { input: `PRAGMA foreign_keys=ON;\n${sql}`, encoding: "utf8" }).trim();
  const migrations = new URL("../migrations/", import.meta.url);
  execute(readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()
    .map(name => readFileSync(new URL(name, migrations), "utf8")).join("\n"));
  const batches = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...params) {
          let index = 0;
          this.sql = sql.replace(/\?/g, () => literal(params[index++]));
          assert.equal(index, params.length, "parameter count must match SQL");
          return this;
        }
      };
    },
    async batch(statements) {
      batches.push(statements.map(statement => statement.sql));
      execute(`BEGIN;\n${statements.map(statement => statement.sql + ";").join("\n")}\nCOMMIT;`);
    }
  };
  DB.prepare = ((prepare) => sql => {
    const statement = prepare(sql);
    statement.run = async function () { const changes = execute(`${this.sql}; select changes();`); return { success: true, meta: { changes: Number(changes) } }; };
    return statement;
  })(DB.prepare);
  return { execute, DB, batches };
}

function posting(overrides = {}) {
  return {
    id: "fixture-job", source: "greenhouse", source_token: "example", company: "Example",
    title: "Engineer", url: "https://example.com/job", industry: "tech", niche: "Software",
    first_seen: "2026-10-01", last_seen: "2026-10-01", last_filled: null,
    location: "Dublin", city: "Dublin", country: "IE", role_family: "Engineering",
    seniority: "Senior", visa: "Unknown", score: 60, tier: "GrowthSaaS", ...overrides
  };
}

test("scan persistence stores changes and daily freshness without rewriting unchanged index entries", async t => {
  const fixture = sqliteFixture(t);
  const save = async (date, job) => persistScanToD1({ DB: fixture.DB }, { postings: { [job.id]: job } }, date, `scan:${date}`);
  await save("2026-10-01", posting());
  await save("2026-10-02", posting({ last_seen: "2026-10-02" }));
  assert.equal(fixture.execute("select count(*) from job_snapshots;"), "1");
  assert.equal(fixture.execute("select last_seen_date from job_postings;"), "2026-10-02");
  assert.equal(fixture.execute("select count(*) from daily_scan_stats;"), "2");
  const statements = fixture.batches.at(-1);
  // The freshness UPSERT's update branch must not rewrite either secondary
  // index. SQLite exposes their writes as IdxInsert opcodes on that branch.
  const plan = fixture.execute(`.explain off\nEXPLAIN ${statements[0]};`).split("\n");
  const update = plan.findIndex(line => /\|Insert\|.*\|job_postings\|/.test(line));
  const updateEnd = plan.findIndex((line, index) => index > update && /\|Goto\|/.test(line));
  assert.ok(update >= 0 && updateEnd > update, plan.filter(line => /Delete|Insert|Goto/.test(line)).join("\n"));
  assert.equal(plan.slice(0, updateEnd).some(line => /\|IdxInsert\|/.test(line)), false);
  const sameDayChanges = fixture.execute(`${statements.map(sql => sql + ";").join("\n")}\nselect total_changes();`);
  assert.equal(sameDayChanges, "0", "replaying identical posting/snapshot writes must be a no-op");
  await save("2026-10-03", posting({ company: "Renamed", industry: "engineering", title: "Civil Engineer", last_filled: "2026-10-03" }));
  assert.equal(fixture.execute("select company || ':' || industry || ':' || is_active || ':' || title from job_postings;"), "Renamed:engineering:0:Civil Engineer");
  await save("2026-10-04", posting({ last_seen: "2026-10-04" }));
  assert.equal(fixture.execute("select is_active from job_postings;"), "1");
  assert.equal(fixture.execute("select count(*) from job_snapshots;"), "3");
});

function storageDeps(fixture) {
  return {
    async run(env, sql, ...params) { return fixture.DB.prepare(sql).bind(...params).run(); },
    async all(env, sql, ...params) {
      const bound = fixture.DB.prepare(sql).bind(...params).sql;
      return JSON.parse(fixture.execute(`.mode json\n${bound};`) || "[]");
    }
  };
}

test("20-day cleanup preserves recent history and latest details, and bounds D1 deletion", async t => {
  const fixture = sqliteFixture(t);
  const save = async (date, job) => persistScanToD1({ DB: fixture.DB }, { postings: { [job.id]: job } }, date, `scan:${date}`);
  await save("2026-08-01", posting({ first_seen: "2026-08-01" }));
  await save("2026-08-02", posting({ score: 55 }));
  await save("2026-09-19", posting({ score: 50 }));
  await save("2026-09-20", posting({ score: 45 }));
  await save("2026-08-01", posting({ id: "saved-old-job", first_seen: "2026-08-01", last_filled: "2026-08-01" }));
  fixture.execute(`insert into job_snapshots (job_id,scan_date,title,created_at)
    select 'fixture-job', date('2020-01-01', '+' || value || ' days'), 'old', 'old'
    from json_each('[${Array.from({ length: SNAPSHOT_CLEANUP_BATCH + 10 }, (_, i) => i).join(",")}]');`);
  const deps = storageDeps(fixture);
  const at = new Date("2026-10-09T00:00:00Z");
  const first = await runScanStorageMaintenance({}, deps, at);
  assert.equal(first.snapshots_deleted, SNAPSHOT_CLEANUP_BATCH);
  assert.equal(fixture.execute("select count(*) from job_snapshots where job_id='saved-old-job';"), "1");
  await runScanStorageMaintenance({}, deps, at);
  assert.equal(fixture.execute("select group_concat(scan_date) from (select scan_date from job_snapshots where job_id='fixture-job' order by scan_date);"), "2026-09-19,2026-09-20");
  assert.equal((await runScanStorageMaintenance({}, deps, at)).snapshots_deleted, 0);
});

test("feed cleanup protects current/rollback pointers and retries R2 failures", async t => {
  const fixture = sqliteFixture(t);
  for (const [version, status, created] of [["current", "current", "2026-08-01"], ["rollback", "retired", "2026-08-01"], ["expired", "retired", "2026-08-01"], ["recent", "retired", "2026-10-01"]]) {
    fixture.execute(`insert into feed_publications (version,r2_key,sha256,byte_size,job_count,status,created_at)
      values ('${version}','feeds/${version}.json','hash',1,1,'${status}','${created}');`);
  }
  fixture.execute("insert into feed_pointer (singleton,current_version,previous_version,updated_at) values (1,'current','rollback','now');");
  const deps = storageDeps(fixture);
  const at = new Date("2026-10-09T00:00:00Z");
  await assert.rejects(runScanStorageMaintenance({ JOB_FEEDS: { async delete() { throw new Error("R2 unavailable"); } } }, deps, at), /R2 unavailable/);
  assert.equal(fixture.execute("select count(*) from feed_publications;"), "4");
  const deleted = [];
  const result = await runScanStorageMaintenance({ JOB_FEEDS: { async delete(key) { deleted.push(key); } } }, deps, at);
  assert.deepEqual(deleted, ["feeds/expired.json"]);
  assert.equal(result.feeds_deleted, 1);
  assert.equal(fixture.execute("select count(*) from feed_publications;"), "3");
});

test("snapshot changes preserve history, null transitions, new arrivals and same-day corrections", async t => {
  const fixture = sqliteFixture(t);
  const save = async (date, job) => persistScanToD1({ DB: fixture.DB }, { postings: { [job.id]: job } }, date, `scan:${date}`);
  await save("2026-10-01", posting());
  for (let day = 2; day <= 8; day++) {
    const date = `2026-10-0${day}`;
    await save(date, posting({ last_seen: date }));
  }
  assert.equal(fixture.execute("select count(*) from job_snapshots;"), "1", "unchanged daily scans must not grow snapshot storage");
  await save("2026-10-09", posting({ location: null, city: null, score: 55 }));
  assert.equal(fixture.execute("select count(*) from job_snapshots;"), "2");
  await save("2026-10-09", posting({ score: 50 }));
  assert.equal(fixture.execute("select location || ':' || score from job_snapshots where scan_date='2026-10-09';"), "Dublin:50");
  assert.equal(fixture.execute("select score from job_snapshots where scan_date='2026-10-01';"), "60", "old snapshots remain intact");
  // A job absent from scan state can return under the same upstream id.
  await save("2026-10-10", posting({ first_seen: "2026-10-10", score: 50 }));
  assert.equal(fixture.execute("select count(*) from job_postings p join job_snapshots s on s.job_id=p.id and s.scan_date='2026-10-10' where p.is_active=1 and s.is_new=1;"), "1");
  await save("2026-10-11", posting({ first_seen: "2026-10-10", last_seen: "2026-10-11", score: 50 }));
  assert.equal(fixture.execute("select count(*) from job_snapshots where scan_date='2026-10-11';"), "0");
});

test("resume maintenance expires reservations using the actual migrated schema", async t => {
  const fixture = sqliteFixture(t);
  fixture.execute(`insert into users (id,email,created_at,updated_at) values ('fixture-user','fixture@example.com','now','now');
    insert into usage_reservations (id,user_id,idempotency_key,expires_at,created_at,updated_at)
      values ('expired','fixture-user','expired','2000-01-01','now','now'),
        ('live','fixture-user','live','2099-01-01','now','now');`);
  await runResumeMaintenance({}, {
    async run(env, sql, ...params) { return fixture.DB.prepare(sql).bind(...params).run(); },
    async all() { return []; }
  });
  assert.equal(fixture.execute("select status || ':' || release_reason from usage_reservations where id='expired';"), "expired:reservation_expired");
  assert.equal(fixture.execute("select status from usage_reservations where id='live';"), "reserved");
});
