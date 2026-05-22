import assert from "node:assert/strict";
import test from "node:test";
import worker, { runScan } from "../src/worker.js";

function createKV(initialState = { postings: {} }) {
  const store = new Map([["state", JSON.stringify(initialState)]]);
  const puts = [];
  return {
    puts,
    async get(key, type) {
      const value = store.get(key) || null;
      if (type === "json") return value ? JSON.parse(value) : null;
      return value;
    },
    async put(key, value) {
      puts.push({ key, value });
      store.set(key, value);
    }
  };
}

function tokenFromUrl(url) {
  const patterns = [
    /boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs/,
    /posting-api\/job-board\/([^/?]+)/,
    /api\.lever\.co\/v0\/postings\/([^/?]+)/,
    /api\.smartrecruiters\.com\/v1\/companies\/([^/]+)\/postings/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function emptyPayload(url) {
  if (url.includes("greenhouse")) return { jobs: [] };
  if (url.includes("ashbyhq")) return { jobs: [] };
  if (url.includes("lever.co")) return [];
  if (url.includes("smartrecruiters")) return { content: [], totalFound: 0 };
  return {};
}

function mockFetch({ failedTokens = new Set(), jobsByToken = {} } = {}) {
  return async url => {
    const token = tokenFromUrl(url);
    if (failedTokens.has(token)) {
      return new Response("failed", { status: 503 });
    }
    const payload = jobsByToken[token] || emptyPayload(url);
    return Response.json(payload);
  };
}

test("runScan matches lowercase/country-hint locations and classifies visa", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      hubspot: {
        jobs: [{
          id: 101,
          title: "Revenue Operations Manager",
          location: { name: "london, england" },
          absolute_url: "https://example.com/hubspot-101"
        }]
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  assert.equal(payload.postings.length, 1);
  assert.equal(payload.postings[0].city, "London");
  assert.equal(payload.postings[0].country, "GB");
  assert.equal(payload.postings[0].visa, "Strong");
});

test("runScan applies company aliases for display and classification", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      talkdesk2: {
        jobs: [{
          id: 202,
          title: "Revenue Operations Manager",
          location: { name: "Lisbon, Portugal" },
          absolute_url: "https://example.com/talkdesk-202"
        }]
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  assert.equal(payload.postings.length, 1);
  assert.equal(payload.postings[0].company, "talkdesk");
  assert.equal(payload.postings[0].source_token, "talkdesk2");
  assert.equal(payload.postings[0].tier, "Ecosystem");
  assert.equal(payload.postings[0].stack_fit, "High");
  assert.equal(payload.postings[0].visa, "Likely");
});

test("runScan preserves previous postings from a failed active source", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    failedTokens: new Set(["hubspot"])
  }));

  const previousPosting = {
    id: "greenhouse-hubspot-1",
    source: "greenhouse",
    company: "hubspot",
    title: "Revenue Operations Lead",
    location: "London",
    city: "London",
    country: "GB",
    url: "https://example.com/old",
    tier: "Ecosystem",
    stack_fit: "High",
    visa: "Strong",
    score: 97,
    first_seen: "2026-05-20",
    last_seen: "2026-05-20",
    last_filled: null
  };
  const KV = createKV({ postings: { [previousPosting.id]: previousPosting } });
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  assert.equal(payload.postings.length, 1);
  assert.equal(payload.postings[0].id, previousPosting.id);
  assert.equal(payload.postings[0].last_filled, null);
});

test("runScan drops postings from retired sources", async t => {
  t.mock.method(globalThis, "fetch", mockFetch());

  const retiredPosting = {
    id: "local-example-1",
    source: "local",
    company: "example",
    title: "Revenue Operations Lead",
    location: "London",
    city: "London",
    country: "GB",
    url: "https://example.com/old",
    tier: "Scaleup",
    stack_fit: "Med",
    visa: "Unknown",
    score: 65,
    first_seen: "2026-05-20",
    last_seen: "2026-05-20",
    last_filled: null
  };
  const KV = createKV({ postings: { [retiredPosting.id]: retiredPosting } });
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  assert.equal(payload.postings.length, 0);
});

test("runScan aborts KV writes when too many sources fail", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    const token = tokenFromUrl(url);
    if (token === "hubspot") return Response.json(emptyPayload(url));
    return new Response("failed", { status: 503 });
  });

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, "too_many_fetch_failures");
  assert.equal(KV.puts.length, 0);
});

test("manual scan accepts X-Scan-Key and rejects missing auth", async t => {
  t.mock.method(globalThis, "fetch", mockFetch());

  const unauthorized = await worker.fetch(new Request("https://example.com/api/scan-now"), {
    KV: createKV(),
    SCAN_KEY: "secret"
  });
  assert.equal(unauthorized.status, 401);

  const KV = createKV();
  const authorized = await worker.fetch(new Request("https://example.com/api/scan-now", {
    headers: { "X-Scan-Key": "secret" }
  }), {
    KV,
    SCAN_KEY: "secret"
  });
  assert.equal(authorized.status, 200);
  const payload = await authorized.json();
  assert.equal(payload.error, undefined);
  assert.ok(KV.puts.some(p => p.key === "jobs"));
});
