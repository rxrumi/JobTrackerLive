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

function samplePostings(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `job-${i + 1}`,
    company: i % 2 ? "hubspot" : "canva",
    title: `Revenue Operations Manager ${i + 1}`,
    country: i % 2 ? "IE" : "AU",
    city: i % 2 ? "Dublin" : "Sydney",
    location: i % 2 ? "Dublin, Ireland" : "Sydney, Australia",
    tier: i % 2 ? "Ecosystem" : "Scaleup",
    role_family: "Operations",
    seniority: "Manager",
    visa: i % 2 ? "Strong" : "Likely",
    score: 100 - i,
    first_seen: "2026-06-01",
    last_seen: "2026-06-02",
    url: `https://example.com/jobs/${i + 1}`
  }));
}

function requestWithCf(url, init, cf) {
  const request = new Request(url, init);
  Object.defineProperty(request, "cf", { value: cf });
  return request;
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
  assert.equal(payload.postings[0].role_family, "Operations");
  assert.equal(payload.postings[0].seniority, "Manager");
  assert.equal(payload.postings[0].visa, "Strong");
  assert.equal(payload.postings[0].score, 94);
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
  assert.equal(payload.postings[0].role_family, "Operations");
  assert.equal(payload.postings[0].visa, "Likely");
});

test("runScan classifies broad professional role families", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      canva: {
        content: [{
          id: "eng-1",
          name: "Senior Software Engineer",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "sales-1",
          name: "Enterprise Account Executive",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "marketing-1",
          name: "Product Marketing Manager",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "finance-1",
          name: "Strategic Finance Analyst",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "product-1",
          name: "Product Manager",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "data-1",
          name: "Data Analyst",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "people-1",
          name: "Talent Acquisition Specialist",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "cs-1",
          name: "Customer Success Manager",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }],
        totalFound: 8
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const families = new Set(payload.postings.map(p => p.role_family));
  assert.equal(payload.postings.length, 8);
  assert.deepEqual(families, new Set([
    "Engineering",
    "Sales",
    "Marketing",
    "Finance",
    "Product",
    "Data/Analytics",
    "People/HR",
    "Customer Success/Support"
  ]));
});

test("runScan excludes early-career and noisy unmatched titles", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      canva: {
        content: [{
          id: "intern-1",
          name: "Software Engineer Intern",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "grad-1",
          name: "Graduate Program - Business Analyst",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "noise-1",
          name: "Office Coordinator, Risk, Ethics",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "legal-1",
          name: "Senior Legal Counsel",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }],
        totalFound: 4
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  assert.equal(payload.postings.length, 1);
  assert.equal(payload.postings[0].title, "Senior Legal Counsel");
  assert.equal(payload.postings[0].role_family, "Legal/Compliance");
});

function createSupabaseFake({ user, exchangeUser, exchangeError = null, oauthUrl = "https://supabase.example/auth/v1/authorize", rows = {} } = {}) {
  const calls = [];
  let currentUser = user || null;
  const data = {
    users: [],
    user_profiles: [],
    agency_profiles: [],
    account_access: [],
    user_jobs: [],
    user_activity: [],
    ...rows
  };

  function matches(row, filters) {
    return filters.every(([col, value]) => row[col] === value);
  }

  function chain(table) {
    const filters = [];
    const api = {
      select() {
        return api;
      },
      eq(col, value) {
        filters.push([col, value]);
        return api;
      },
      maybeSingle() {
        return Promise.resolve({
          data: (data[table] || []).find(row => matches(row, filters)) || null,
          error: null
        });
      },
      single() {
        return Promise.resolve({
          data: (data[table] || []).find(row => matches(row, filters)) || null,
          error: null
        });
      },
      order() {
        return Promise.resolve({
          data: (data[table] || []).filter(row => matches(row, filters)),
          error: null
        });
      },
      insert(payload) {
        const row = Array.isArray(payload) ? payload[0] : payload;
        calls.push({ table, action: "insert", payload: row });
        data[table].push(row);
        return Promise.resolve({ data: row, error: null });
      },
      update(payload) {
        return {
          eq(col, value) {
            calls.push({ table, action: "update", payload, filter: [col, value] });
            for (const row of data[table]) {
              if (row[col] === value) Object.assign(row, payload);
            }
            return Promise.resolve({ data: null, error: null });
          }
        };
      },
      upsert(payload, options = {}) {
        const row = { ...payload };
        calls.push({ table, action: "upsert", payload: row, options });
        const conflictCols = (options.onConflict || "").split(",").filter(Boolean);
        const existing = conflictCols.length
          ? data[table].find(item => conflictCols.every(col => item[col] === row[col]))
          : null;
        let saved = row;
        if (existing) {
          if (!options.ignoreDuplicates) Object.assign(existing, row);
          saved = existing;
        } else {
          data[table].push(row);
        }
        const promise = Promise.resolve({ data: saved, error: null });
        promise.select = () => ({
          single: () => Promise.resolve({ data: saved, error: null })
        });
        return promise;
      }
    };
    return api;
  }

  return {
    calls,
    rows: data,
    auth: {
      getUser: async () => currentUser ? { data: { user: currentUser }, error: null } : { data: { user: null }, error: { message: "unauthorized" } },
      signInWithOAuth: async options => {
        calls.push({ table: "auth", action: "signInWithOAuth", payload: options });
        return { data: { url: oauthUrl }, error: null };
      },
      exchangeCodeForSession: async code => {
        calls.push({ table: "auth", action: "exchangeCodeForSession", payload: code });
        if (exchangeError) return { data: null, error: exchangeError };
        currentUser = exchangeUser || currentUser;
        return { data: { user: currentUser }, error: null };
      },
      signOut: async () => ({ error: null })
    },
    from: chain
  };
}

test("account routes require authentication without affecting public jobs", async () => {
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(20) }));

  const jobsResponse = await worker.fetch(new Request("https://example.com/api/jobs"), { KV });
  assert.equal(jobsResponse.status, 200);
  assert.equal(jobsResponse.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(jobsResponse.headers.get("Access-Control-Allow-Origin"), null);
  const jobsPayload = await jobsResponse.json();
  assert.equal(jobsPayload.postings.length, 15);
  assert.equal(jobsPayload.pagination.page, 1);
  assert.equal(jobsPayload.pagination.total, 20);
  assert.equal(jobsPayload.pagination.total_pages, 2);

  const meResponse = await worker.fetch(new Request("https://example.com/api/me"), { KV });
  assert.equal(meResponse.status, 401);
});

test("jobs query allows anonymous page one and caps per_page at fifteen", async () => {
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(20) }));

  const response = await worker.fetch(new Request("https://example.com/api/jobs/query", {
    method: "POST",
    body: JSON.stringify({ page: 1, per_page: 50 })
  }), { KV });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.postings.length, 15);
  assert.equal(payload.pagination.per_page, 15);
  assert.equal(payload.pagination.total_pages, 2);
});

test("jobs query rejects anonymous page two", async () => {
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(20) }));

  const response = await worker.fetch(new Request("https://example.com/api/jobs/query", {
    method: "POST",
    body: JSON.stringify({ page: 2 })
  }), { KV });

  assert.equal(response.status, 401);
});

test("jobs query requires human verification for authenticated page two", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000020", email: "king@example.com" };
  const fake = createSupabaseFake({ user });
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(20) }));

  const response = await worker.fetch(new Request("https://example.com/api/jobs/query", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ page: 2 })
  }), {
    KV,
    SUPABASE_CLIENT: fake,
    PAGE_ACCESS_SECRET: "page-secret",
    TURNSTILE_SECRET: "turnstile-secret"
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "human_verification_required");
});

test("jobs query allows authenticated page two with valid Turnstile and sets clearance cookie", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    return Response.json({ success: true });
  });
  const user = { id: "00000000-0000-4000-8000-000000000021", email: "king@example.com" };
  const fake = createSupabaseFake({ user });
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(20) }));

  const response = await worker.fetch(new Request("https://example.com/api/jobs/query", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ page: 2, turnstile_token: "token" })
  }), {
    KV,
    SUPABASE_CLIENT: fake,
    PAGE_ACCESS_SECRET: "page-secret",
    TURNSTILE_SECRET: "turnstile-secret"
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Set-Cookie"), /job_page_access=/);
  const payload = await response.json();
  assert.equal(payload.pagination.page, 2);
  assert.equal(payload.postings.length, 5);
});

test("jobs query clamps out-of-range pages", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true }));
  const user = { id: "00000000-0000-4000-8000-000000000022", email: "king@example.com" };
  const fake = createSupabaseFake({ user });
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(20) }));

  const response = await worker.fetch(new Request("https://example.com/api/jobs/query", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ page: 99, turnstile_token: "token" })
  }), {
    KV,
    SUPABASE_CLIENT: fake,
    PAGE_ACCESS_SECRET: "page-secret",
    TURNSTILE_SECRET: "turnstile-secret"
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.pagination.page, 2);
  assert.equal(payload.postings.length, 5);
});

test("jobs query rejects low bot scores when Cloudflare bot data is present", async () => {
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(20) }));
  const request = requestWithCf("https://example.com/api/jobs/query", {
    method: "POST",
    body: JSON.stringify({ page: 1 })
  }, { botManagement: { score: 10, verifiedBot: false } });

  const response = await worker.fetch(request, { KV });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "bot_check_failed");
});

test("complete onboarding requires an individual profile for individual accounts", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000001", email: "king@example.com" };
  const fake = createSupabaseFake({
    user,
    rows: {
      users: [{ id: user.id, email: user.email, account_type: "individual", onboarding_completed: false }],
      account_access: [{ user_id: user.id, account_type: "individual", plan: "free" }]
    }
  });

  const response = await worker.fetch(new Request("https://example.com/api/onboarding/complete", {
    method: "POST",
    headers: { Cookie: "session=1" }
  }), { KV: createKV(), SUPABASE_CLIENT: fake });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "individual profile is required");
});

test("me exposes signup full name from auth metadata", async () => {
  const user = {
    id: "00000000-0000-4000-8000-000000000010",
    email: "king@example.com",
    user_metadata: { full_name: "Sohaib Kazmi" }
  };
  const fake = createSupabaseFake({ user });

  const response = await worker.fetch(new Request("https://example.com/api/me", {
    headers: { Cookie: "session=1" }
  }), { KV: createKV(), SUPABASE_CLIENT: fake });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.auth_user.full_name, "Sohaib Kazmi");
});

test("google auth route redirects to Supabase OAuth with app callback", async () => {
  const fake = createSupabaseFake({
    oauthUrl: "https://rjdlgvltsszkjrixifim.supabase.co/auth/v1/authorize?provider=google"
  });

  const response = await worker.fetch(new Request("https://livejobindex.com/api/auth/google"), {
    KV: createKV(),
    SUPABASE_CLIENT: fake
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://rjdlgvltsszkjrixifim.supabase.co/auth/v1/authorize?provider=google");
  const call = fake.calls.find(item => item.action === "signInWithOAuth");
  assert.equal(call.payload.provider, "google");
  assert.equal(call.payload.options.redirectTo, "https://livejobindex.com/auth/callback");
});

test("auth callback exchanges code, ensures account rows, records activity, and redirects home", async () => {
  const user = {
    id: "00000000-0000-4000-8000-000000000011",
    email: "king@example.com",
    user_metadata: { name: "Sohaib Kazmi" }
  };
  const fake = createSupabaseFake({ exchangeUser: user });

  const response = await worker.fetch(new Request("https://livejobindex.com/auth/callback?code=oauth-code"), {
    KV: createKV(),
    SUPABASE_CLIENT: fake
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/");
  assert.deepEqual(fake.calls.find(item => item.action === "exchangeCodeForSession").payload, "oauth-code");
  assert.ok(fake.calls.some(item => item.table === "users" && item.action === "upsert" && item.payload.id === user.id));
  assert.ok(fake.calls.some(item => item.table === "account_access" && item.action === "upsert" && item.payload.user_id === user.id));
  assert.ok(fake.calls.some(item => item.table === "users" && item.action === "update" && item.payload.email === user.email));
  assert.ok(fake.calls.some(item => item.table === "user_activity" && item.action === "insert" && item.payload.event_type === "login_google"));
});

test("auth callback missing code redirects with auth error", async () => {
  const response = await worker.fetch(new Request("https://livejobindex.com/auth/callback"), {
    KV: createKV(),
    SUPABASE_CLIENT: createSupabaseFake()
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/?auth_error=missing_code");
});

test("auth callback exchange failure redirects with auth error", async () => {
  const fake = createSupabaseFake({ exchangeError: { message: "invalid code" } });

  const response = await worker.fetch(new Request("https://livejobindex.com/auth/callback?code=bad-code"), {
    KV: createKV(),
    SUPABASE_CLIENT: fake
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/?auth_error=oauth_exchange_failed");
});

test("complete onboarding requires an agency profile for agency accounts", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000002", email: "agency@example.com" };
  const fake = createSupabaseFake({
    user,
    rows: {
      users: [{ id: user.id, email: user.email, account_type: "agency", onboarding_completed: false }],
      account_access: [{ user_id: user.id, account_type: "agency", plan: "free" }]
    }
  });

  const response = await worker.fetch(new Request("https://example.com/api/onboarding/complete", {
    method: "POST",
    headers: { Cookie: "session=1" }
  }), { KV: createKV(), SUPABASE_CLIENT: fake });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "agency profile is required");
});

test("user job upsert stores status, star, and derived timestamps", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000003", email: "king@example.com" };
  const fake = createSupabaseFake({ user });

  const response = await worker.fetch(new Request("https://example.com/api/user-jobs/greenhouse-hubspot-101", {
    method: "PUT",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ status: "Applied", starred: true, notes: "High fit" })
  }), { KV: createKV(), SUPABASE_CLIENT: fake });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.job.user_id, user.id);
  assert.equal(payload.job.job_id, "greenhouse-hubspot-101");
  assert.equal(payload.job.status, "Applied");
  assert.equal(payload.job.starred, true);
  assert.equal(payload.job.notes, "High fit");
  assert.ok(payload.job.saved_at);
  assert.ok(payload.job.applied_at);
  assert.equal(payload.job.archived_at, null);
});

test("settings route stores per-user brand theme", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000004", email: "king@example.com" };
  const fake = createSupabaseFake({
    user,
    rows: {
      users: [{ id: user.id, email: user.email, account_type: "individual", onboarding_completed: true, brand_theme: "cobalt" }],
      account_access: [{ user_id: user.id, account_type: "individual", plan: "free" }]
    }
  });

  const response = await worker.fetch(new Request("https://example.com/api/settings", {
    method: "PATCH",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ brand_theme: "aurora" })
  }), { KV: createKV(), SUPABASE_CLIENT: fake });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.brand_theme, "aurora");
  assert.ok(fake.calls.some(item => item.table === "users" && item.action === "update" && item.payload.brand_theme === "aurora"));
  assert.ok(fake.calls.some(item => item.table === "user_activity" && item.action === "insert" && item.payload.event_type === "settings_updated"));

  const invalid = await worker.fetch(new Request("https://example.com/api/settings", {
    method: "PATCH",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ brand_theme: "sepia" })
  }), { KV: createKV(), SUPABASE_CLIENT: fake });

  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, "brand_theme must be cobalt, graphite, or aurora");
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
    role_family: "Operations",
    seniority: "Senior/Lead",
    visa: "Strong",
    score: 96,
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
    role_family: "Operations",
    seniority: "Senior/Lead",
    visa: "Unknown",
    score: 68,
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
