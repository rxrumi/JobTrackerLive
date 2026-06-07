import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import worker, { runScan } from "../src/worker.js";

function createKV(initialState = { postings: {} }, initialJobs = null) {
  const store = new Map([["state", JSON.stringify(initialState)]]);
  if (initialJobs) store.set("jobs", JSON.stringify(initialJobs));
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
    tier: i % 2 ? "GrowthSaaS" : "Scaleup",
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

function createAssets() {
  return {
    requests: [],
    async fetch(request) {
      const url = new URL(request.url);
      this.requests.push(url.pathname);
      if (url.pathname === "/privacy.html") {
        return new Response("privacy", { headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/terms.html") {
        return new Response("terms", { headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/robots.txt") {
        return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      }
      if (url.pathname === "/sitemap.xml") {
        return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset></urlset>", { headers: { "content-type": "application/xml" } });
      }
      if (url.pathname === "/llms.txt") {
        return new Response("# Live Job Index\n", { headers: { "content-type": "text/plain" } });
      }
      if (url.pathname === "/") {
        return new Response("<!DOCTYPE html><title>Live Job Index</title>", { headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/profile" || url.pathname === "/onboarding" || url.pathname === "/auth/callback") {
        return new Response("<!DOCTYPE html><title>Live Job Index</title>", { headers: { "content-type": "text/html" } });
      }
      return new Response("missing", { status: 404 });
    }
  };
}

test("canonical redirects preserve path and query", async () => {
  const httpResponse = await worker.fetch(new Request("http://livejobindex.com/privacy?source=test"), {});
  const wwwResponse = await worker.fetch(new Request("https://www.livejobindex.com/terms?source=test"), {});

  assert.equal(httpResponse.status, 301);
  assert.equal(httpResponse.headers.get("location"), "https://livejobindex.com/privacy?source=test");
  assert.equal(wwwResponse.status, 301);
  assert.equal(wwwResponse.headers.get("location"), "https://livejobindex.com/terms?source=test");
});

test("legal pages are served from static assets without SPA fallback", async () => {
  const ASSETS = createAssets();

  const privacyResponse = await worker.fetch(new Request("https://livejobindex.com/privacy"), { ASSETS });
  const termsResponse = await worker.fetch(new Request("https://livejobindex.com/terms?utm=test"), { ASSETS });

  assert.equal(privacyResponse.status, 200);
  assert.equal(await privacyResponse.text(), "privacy");
  assert.equal(termsResponse.status, 200);
  assert.equal(await termsResponse.text(), "terms");
  assert.equal(privacyResponse.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(privacyResponse.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(ASSETS.requests, ["/privacy.html", "/terms.html"]);
});

test("crawler files are served as static files without SPA fallback", async () => {
  const ASSETS = createAssets();

  const robotsResponse = await worker.fetch(new Request("https://livejobindex.com/robots.txt"), { ASSETS });
  const sitemapResponse = await worker.fetch(new Request("https://livejobindex.com/sitemap.xml"), { ASSETS });
  const llmsResponse = await worker.fetch(new Request("https://livejobindex.com/llms.txt"), { ASSETS });

  assert.equal(robotsResponse.status, 200);
  assert.match(robotsResponse.headers.get("content-type"), /text\/plain/);
  assert.match(await robotsResponse.text(), /User-agent: \*/);
  assert.equal(sitemapResponse.status, 200);
  assert.match(sitemapResponse.headers.get("content-type"), /application\/xml/);
  assert.match(await sitemapResponse.text(), /<urlset/);
  assert.equal(llmsResponse.status, 200);
  assert.match(llmsResponse.headers.get("content-type"), /text\/plain/);
  assert.match(await llmsResponse.text(), /Live Job Index/);
  assert.deepEqual(ASSETS.requests, ["/robots.txt", "/sitemap.xml", "/llms.txt"]);
});

test("profile and onboarding routes resolve through static asset fallback with trust headers", async () => {
  const ASSETS = createAssets();

  const profileResponse = await worker.fetch(new Request("https://livejobindex.com/profile"), { ASSETS });
  const onboardingResponse = await worker.fetch(new Request("https://livejobindex.com/onboarding"), { ASSETS });

  assert.equal(profileResponse.status, 200);
  assert.match(await profileResponse.text(), /Live Job Index/);
  assert.equal(profileResponse.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(onboardingResponse.status, 200);
  assert.match(await onboardingResponse.text(), /Live Job Index/);
  assert.equal(onboardingResponse.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.deepEqual(ASSETS.requests, ["/profile", "/onboarding"]);
});

test("public SEO pillar routes render crawlable metadata from Worker", async () => {
  const KV = createKV({ postings: {} }, {
    last_scan: "2026-06-04",
    postings: samplePostings(4)
  });

  const cases = [
    ["/jobs", "Explore Live Jobs at Top Global Tech Companies", "https://livejobindex.com/jobs"],
    ["/visa-roles", "Visa-Aware Tech Roles with Strong Hiring Signals", "https://livejobindex.com/visa-roles"],
    ["/pipeline", "My Pipeline: Save Targets and Track Applications", "https://livejobindex.com/pipeline"],
    ["/insights", "Market Insights for Global Tech Hiring", "https://livejobindex.com/insights"]
  ];

  for (const [path, title, canonical] of cases) {
    const response = await worker.fetch(new Request(`https://livejobindex.com${path}`), { KV });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
    assert.match(html, new RegExp(`<title>${title}</title>`));
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}">`));
    assert.match(html, /<script type="application\/ld\+json">/);
    assert.match(html, /visa-aware/i);
    assert.match(html, /mailto:business@livejobindex\.com/);
    assert.match(html, /mailto:hello@livejobindex\.com/);
    assert.doesNotMatch(html, /verified visa sponsorship/i);
  }
});

test("homepage source exposes legal discovery links and structured data", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /Live Job Index: Find Active Openings at Top Global Tech Companies/);
  assert.match(html, /Find real-time openings at the world's leading tech companies/);
  assert.doesNotMatch(html, /<nav class="public-nav" aria-label="Product pages">/);
  assert.match(html, /<nav class="tabs" id="tabs">/);
  assert.doesNotMatch(html, /<a href="\/jobs">Live Jobs<\/a>/);
  assert.match(html, /data-route="\/visa-roles"/);
  assert.match(html, /data-tab="pipeline"/);
  assert.match(html, /data-route="\/insights"/);
  assert.match(html, /Business inquiries: <a href="mailto:business@livejobindex\.com">business@livejobindex\.com<\/a>/);
  assert.match(html, /General inquiries: <a href="mailto:hello@livejobindex\.com">hello@livejobindex\.com<\/a>/);
  assert.doesNotMatch(html, /verified visa sponsorship/i);
  assert.match(html, /rel="privacy-policy" href="https:\/\/livejobindex\.com\/privacy"/);
  assert.match(html, /rel="terms-of-service" href="https:\/\/livejobindex\.com\/terms"/);
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.match(html, /"@type": "WebApplication"/);
  assert.match(html, /Tracking Methodology/);
});

test("legal page sources expose footer contact emails", () => {
  const privacy = readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
  const terms = readFileSync(new URL("../public/terms.html", import.meta.url), "utf8");

  for (const html of [privacy, terms]) {
    assert.match(html, /mailto:business@livejobindex\.com/);
    assert.match(html, /mailto:hello@livejobindex\.com/);
    assert.match(html, /Business inquiries/);
    assert.match(html, /General inquiries/);
  }
});

test("sitemap source includes public SEO pillar routes", () => {
  const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");

  assert.match(sitemap, /<loc>https:\/\/livejobindex\.com\/jobs<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/livejobindex\.com\/visa-roles<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/livejobindex\.com\/pipeline<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/livejobindex\.com\/insights<\/loc>/);
});

test("homepage source includes routed profile and onboarding handling", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /APP_ROUTES = new Set\(\['\/', '\/visa-roles', '\/profile', '\/onboarding', '\/pipeline', '\/insights'\]\)/);
  assert.match(html, /function applyRoute\(\)/);
  assert.match(html, /navigateTo\('\/profile'\)/);
  assert.doesNotMatch(html, /account-pill'\)\.onclick = showProfilePanel/);
});

test("homepage defaults signed-out theme to graphite and uses icon-only header toggle", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /<html lang="en" data-theme="dark" data-brand-theme="graphite">/);
  assert.match(html, /var brandTheme = 'graphite'/);
  assert.match(html, /const DEFAULT_BRAND_THEME = 'graphite'/);
  assert.match(html, /<button class="theme-toggle" id="theme-toggle"[^>]*>◐<\/button>/);
  assert.match(html, /btn\.textContent = '◐'/);
  assert.doesNotMatch(html, /theme-toggle"[^>]*>Cobalt<\/button>/);
  assert.doesNotMatch(html, /theme-toggle"[^>]*>Graphite<\/button>/);
  assert.doesNotMatch(html, /theme-toggle"[^>]*>Aurora<\/button>/);
});

test("homepage exposes United States in market constants and generated country controls", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /US: 'United States'/);
  assert.match(html, /US: '🇺🇸'/);
  assert.match(html, /United States, UK, Ireland, Canada/);
  assert.match(html, /buildCheckGrid\('individual-countries', countryEntries\);/);
  assert.match(html, /buildCheckGrid\('profile-individual-countries', countryEntries\);/);
  assert.match(html, /company: 'Google', country: 'US', city: 'New York'/);
});

test("homepage silently relaxes onboarding filters when profile defaults have no active matches", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /function relaxedProfileFilterStates\(profile\)/);
  assert.match(html, /const withoutRole = \{ \.\.\.full, family: new Set\(\) \};/);
  assert.match(html, /const withoutRoleOrCountry = \{ \.\.\.withoutRole, country: new Set\(\) \};/);
  assert.match(html, /seniority: new Set\(\),\n    visa: new Set\(\)/);
  assert.match(html, /const selected = candidates\.find\(activeMatchCountForControls\) \|\| candidates\[candidates\.length - 1\];/);
  assert.match(html, /PROFILE_FILTERS_RELAXED = selected !== candidates\[0\];/);
});

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

test("runScan matches United States city and remote country-hint locations", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      hubspot: {
        jobs: [{
          id: 301,
          title: "Revenue Operations Manager",
          location: { name: "New York, United States" },
          absolute_url: "https://example.com/hubspot-301"
        }, {
          id: 302,
          title: "Sales Operations Manager",
          location: { name: "Remote - US" },
          absolute_url: "https://example.com/hubspot-302"
        }]
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  assert.equal(payload.postings.length, 2);

  const byTitle = new Map(payload.postings.map(p => [p.title, p]));
  assert.equal(byTitle.get("Revenue Operations Manager").city, "New York");
  assert.equal(byTitle.get("Revenue Operations Manager").country, "US");
  assert.equal(byTitle.get("Sales Operations Manager").city, "Remote - US");
  assert.equal(byTitle.get("Sales Operations Manager").country, "US");
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
  assert.equal(payload.postings[0].tier, "GrowthSaaS");
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

function createSupabaseFake({ user, exchangeUser, exchangeError = null, sessionUser, sessionError = null, oauthUrl = "https://supabase.example/auth/v1/authorize", rows = {} } = {}) {
  const calls = [];
  let currentUser = user || null;
  const data = {
    users: [],
    user_profiles: [],
    agency_profiles: [],
    account_access: [],
    user_jobs: [],
    user_activity: [],
    user_job_history: [],
    agency_feedback: [],
    job_postings: [],
    job_snapshots: [],
    daily_scan_stats: [],
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
      setSession: async session => {
        calls.push({ table: "auth", action: "setSession", payload: session });
        if (sessionError) return { data: null, error: sessionError };
        currentUser = sessionUser || currentUser;
        return { data: { session, user: currentUser }, error: null };
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

test("json responses include production security headers", async () => {
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(1) }));

  const response = await worker.fetch(new Request("https://livejobindex.com/api/jobs"), { KV });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(response.headers.get("content-security-policy"), /cdn\.jsdelivr\.net/);
});

test("mutating api routes reject mismatched browser origins", async () => {
  const response = await worker.fetch(new Request("https://livejobindex.com/api/session", {
    method: "POST",
    headers: { Origin: "https://evil.example" }
  }), {});

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "invalid_origin");
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

test("jobs query normalizes legacy Ecosystem tier values", async () => {
  const KV = createKV();
  const legacy = { ...samplePostings(1)[0], tier: "Ecosystem" };
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: [legacy] }));

  const response = await worker.fetch(new Request("https://example.com/api/jobs/query", {
    method: "POST",
    body: JSON.stringify({ page: 1, filters: { tier: ["Ecosystem"] } })
  }), { KV });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.pagination.total, 1);
  assert.equal(payload.postings[0].tier, "GrowthSaaS");
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

test("jobs query rejects Turnstile tokens for the wrong hostname or action", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    success: true,
    hostname: "evil.example",
    action: "jobs_page_access"
  }));
  const user = { id: "00000000-0000-4000-8000-000000000023", email: "king@example.com" };
  const fake = createSupabaseFake({ user });
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(20) }));

  const response = await worker.fetch(new Request("https://livejobindex.com/api/jobs/query", {
    method: "POST",
    headers: { Cookie: "session=1", Origin: "https://livejobindex.com" },
    body: JSON.stringify({ page: 2, turnstile_token: "token" })
  }), {
    KV,
    SUPABASE_CLIENT: fake,
    PAGE_ACCESS_SECRET: "page-secret",
    TURNSTILE_SECRET: "turnstile-secret"
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "human_verification_required");
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

test("agency feedback requires authentication", async () => {
  const response = await worker.fetch(new Request("https://example.com/api/agency-feedback", {
    method: "POST",
    body: JSON.stringify({ message: "Add API exports." })
  }), { KV: createKV() });

  assert.equal(response.status, 401);
});

test("agency feedback rejects non-agency and incomplete accounts", async () => {
  const individualUser = { id: "00000000-0000-4000-8000-000000000031", email: "individual@example.com" };
  const incompleteAgencyUser = { id: "00000000-0000-4000-8000-000000000032", email: "agency@example.com" };
  const individualFake = createSupabaseFake({
    user: individualUser,
    rows: {
      users: [{ id: individualUser.id, email: individualUser.email, account_type: "individual", onboarding_completed: true }],
      user_profiles: [{
        user_id: individualUser.id,
        full_name: "Individual User",
        current_title: "Operator",
        years_experience: 5,
        target_role_families: ["Operations"],
        target_seniority: "Manager",
        target_countries: ["GB"]
      }],
      account_access: [{ user_id: individualUser.id, account_type: "individual", plan: "free" }]
    }
  });
  const incompleteAgencyFake = createSupabaseFake({
    user: incompleteAgencyUser,
    rows: {
      users: [{ id: incompleteAgencyUser.id, email: incompleteAgencyUser.email, account_type: "agency", onboarding_completed: false }],
      agency_profiles: [{
        user_id: incompleteAgencyUser.id,
        agency_name: "Pipeline Studio",
        agency_type: "lead_gen_agency",
        use_case: "lead_generation",
        integration_interest: "api",
        target_role_families: ["Sales"],
        target_countries: ["GB"]
      }],
      account_access: [{ user_id: incompleteAgencyUser.id, account_type: "agency", plan: "free" }]
    }
  });

  const individualResponse = await worker.fetch(new Request("https://example.com/api/agency-feedback", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ message: "Need an API." })
  }), { KV: createKV(), SUPABASE_CLIENT: individualFake });
  const incompleteResponse = await worker.fetch(new Request("https://example.com/api/agency-feedback", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ message: "Need an API." })
  }), { KV: createKV(), SUPABASE_CLIENT: incompleteAgencyFake });

  assert.equal(individualResponse.status, 403);
  assert.equal(incompleteResponse.status, 403);
});

test("agency feedback validates message length", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000033", email: "agency@example.com" };
  const fake = createSupabaseFake({
    user,
    rows: {
      users: [{ id: user.id, email: user.email, account_type: "agency", onboarding_completed: true }],
      agency_profiles: [{
        user_id: user.id,
        agency_name: "Growth Desk",
        agency_type: "lead_gen_agency",
        use_case: "lead_generation",
        integration_interest: "api",
        target_role_families: ["Sales"],
        target_countries: ["GB"]
      }],
      account_access: [{ user_id: user.id, account_type: "agency", plan: "free" }]
    }
  });

  const blankResponse = await worker.fetch(new Request("https://example.com/api/agency-feedback", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ message: "   " })
  }), { KV: createKV(), SUPABASE_CLIENT: fake });
  const longResponse = await worker.fetch(new Request("https://example.com/api/agency-feedback", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ message: "x".repeat(2001) })
  }), { KV: createKV(), SUPABASE_CLIENT: fake });

  assert.equal(blankResponse.status, 400);
  assert.equal((await blankResponse.json()).error, "message is required");
  assert.equal(longResponse.status, 400);
  assert.equal((await longResponse.json()).error, "message must be 2000 characters or fewer");
});

test("agency feedback saves completed agency feedback with profile metadata", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000034", email: "agency@example.com" };
  const fake = createSupabaseFake({
    user,
    rows: {
      users: [{ id: user.id, email: user.email, account_type: "agency", onboarding_completed: true }],
      agency_profiles: [{
        user_id: user.id,
        agency_name: "Lead Forge",
        agency_type: "lead_gen_agency",
        use_case: "lead_generation",
        integration_interest: "clay",
        monthly_data_volume: "5000/month",
        target_role_families: ["Sales"],
        target_countries: ["GB"]
      }],
      account_access: [{ user_id: user.id, account_type: "agency", plan: "free" }]
    }
  });

  const response = await worker.fetch(new Request("https://example.com/api/agency-feedback", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ message: "Please add API keys and Clay export support." })
  }), { KV: createKV(), SUPABASE_CLIENT: fake });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  const feedbackCall = fake.calls.find(item => item.table === "agency_feedback" && item.action === "insert");
  assert.equal(feedbackCall.payload.user_id, user.id);
  assert.equal(feedbackCall.payload.agency_name, "Lead Forge");
  assert.equal(feedbackCall.payload.message, "Please add API keys and Clay export support.");
  assert.deepEqual(feedbackCall.payload.metadata, {
    agency_type: "lead_gen_agency",
    use_case: "lead_generation",
    integration_interest: "clay",
    monthly_data_volume: "5000/month"
  });
  assert.ok(fake.calls.find(item => item.table === "user_activity" && item.action === "insert" && item.payload.event_type === "agency_feedback_submitted"));
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

test("public config exposes browser auth settings", async () => {
  const response = await worker.fetch(new Request("https://livejobindex.com/api/config"), {
    TURNSTILE_SITE_KEY: "turnstile-public-key",
    SUPABASE_URL: "https://rjdlgvltsszkjrixifim.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public"
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
  const payload = await response.json();
  assert.deepEqual(payload, {
    turnstile_site_key: "turnstile-public-key",
    supabase_url: "https://rjdlgvltsszkjrixifim.supabase.co",
    supabase_publishable_key: "sb_publishable_public"
  });
});

test("legacy google auth route redirects to frontend auth error", async () => {
  const fake = createSupabaseFake();

  const response = await worker.fetch(new Request("https://livejobindex.com/api/auth/google?next=/profile"), {
    KV: createKV(),
    SUPABASE_CLIENT: fake
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/?auth_error=google_frontend_required");
  assert.equal(fake.calls.some(item => item.action === "signInWithOAuth"), false);
});

test("auth callback serves the frontend app shell", async () => {
  const ASSETS = createAssets();

  const response = await worker.fetch(new Request("https://livejobindex.com/auth/callback?code=oauth-code"), {
    ASSETS,
    KV: createKV()
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(ASSETS.requests, ["/auth/callback"]);
});

test("auth session bridge validates tokens, ensures account rows, records activity, and returns me", async () => {
  const user = {
    id: "00000000-0000-4000-8000-000000000011",
    email: "king@example.com",
    user_metadata: { name: "Sohaib Kazmi" }
  };
  const fake = createSupabaseFake({ sessionUser: user });

  const response = await worker.fetch(new Request("https://livejobindex.com/api/auth/session", {
    method: "POST",
    body: JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token" })
  }), {
    KV: createKV(),
    SUPABASE_CLIENT: fake
  });

  assert.equal(response.status, 200);
  assert.deepEqual(fake.calls.find(item => item.action === "setSession").payload, {
    access_token: "access-token",
    refresh_token: "refresh-token"
  });
  assert.ok(fake.calls.some(item => item.table === "users" && item.action === "upsert" && item.payload.id === user.id));
  assert.ok(fake.calls.some(item => item.table === "users" && item.action === "upsert" && item.payload.brand_theme === "graphite"));
  assert.ok(fake.calls.some(item => item.table === "account_access" && item.action === "upsert" && item.payload.user_id === user.id));
  assert.ok(fake.calls.some(item => item.table === "users" && item.action === "update" && item.payload.email === user.email));
  assert.ok(fake.calls.some(item => item.table === "user_activity" && item.action === "insert" && item.payload.event_type === "login_google"));
  const payload = await response.json();
  assert.equal(payload.auth_user.id, user.id);
  assert.equal(payload.auth_user.full_name, "Sohaib Kazmi");
});

test("auth session bridge rejects missing tokens", async () => {
  const response = await worker.fetch(new Request("https://livejobindex.com/api/auth/session", {
    method: "POST",
    body: JSON.stringify({ access_token: "access-token" })
  }), {
    KV: createKV(),
    SUPABASE_CLIENT: createSupabaseFake()
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "access_token and refresh_token are required");
});

test("auth session bridge rejects invalid sessions", async () => {
  const fake = createSupabaseFake({ sessionError: { message: "invalid token" } });

  const response = await worker.fetch(new Request("https://livejobindex.com/api/auth/session", {
    method: "POST",
    body: JSON.stringify({ access_token: "bad-access-token", refresh_token: "bad-refresh-token" })
  }), {
    KV: createKV(),
    SUPABASE_CLIENT: fake
  });

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error, "invalid_session");
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
    tier: "GrowthSaaS",
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

test("manual scan uses json security responses for wrong keys", async t => {
  t.mock.method(globalThis, "fetch", mockFetch());

  const response = await worker.fetch(new Request("https://example.com/api/scan-now", {
    headers: { "X-Scan-Key": "wrong" }
  }), {
    KV: createKV(),
    SCAN_KEY: "secret"
  });

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await response.json()).error, "unauthorized");
});

test("manual scan persists Supabase analytics with REST upserts", async t => {
  const supabaseCalls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith("https://supabase.example/rest/v1/")) {
      supabaseCalls.push({
        url: href,
        method: init.method,
        prefer: init.headers?.Prefer || init.headers?.prefer,
        body: init.body ? JSON.parse(init.body) : null
      });
      return new Response(null, { status: 201 });
    }

    const token = tokenFromUrl(href);
    if (token === "hubspot") {
      return Response.json({
        jobs: [{
          id: 101,
          title: "Revenue Operations Manager",
          location: { name: "Dublin, Ireland" },
          absolute_url: "https://example.com/hubspot-101"
        }]
      });
    }
    return Response.json(emptyPayload(href));
  });

  const KV = createKV();
  const waitUntil = [];
  const response = await worker.fetch(new Request("https://example.com/api/scan-now", {
    headers: { "X-Scan-Key": "scan-secret" }
  }), {
    KV,
    SCAN_KEY: "scan-secret",
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key"
  }, {
    waitUntil(promise) {
      waitUntil.push(promise);
    }
  });

  assert.equal(response.status, 200);
  await Promise.all(waitUntil);

  const jobPostingsCall = supabaseCalls.find(call => call.url.includes("/job_postings?"));
  const snapshotsCall = supabaseCalls.find(call => call.url.includes("/job_snapshots?"));
  const statsCall = supabaseCalls.find(call => call.url.includes("/daily_scan_stats?"));

  assert.ok(jobPostingsCall);
  assert.ok(snapshotsCall);
  assert.ok(statsCall);
  assert.match(jobPostingsCall.url, /on_conflict=id/);
  assert.match(snapshotsCall.url, /on_conflict=job_id%2Cscan_date/);
  assert.match(statsCall.url, /on_conflict=scan_date/);
  assert.equal(jobPostingsCall.prefer, "resolution=merge-duplicates,return=minimal");
  assert.equal(snapshotsCall.prefer, "resolution=merge-duplicates,return=minimal");
  assert.equal(statsCall.prefer, "resolution=merge-duplicates,return=minimal");
});

test("session endpoint creates anonymous session cookie", async () => {
  const response = await worker.fetch(new Request("https://example.com/api/session", {
    method: "POST"
  }), {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.session_token);
  assert.match(response.headers.get("Set-Cookie") || "", /lji_session=/);
});

test("session endpoint returns existing token when cookie present", async () => {
  const response = await worker.fetch(new Request("https://example.com/api/session", {
    method: "POST",
    headers: { Cookie: "lji_session=existing-token" }
  }), {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.session_token, "existing-token");
});

test("track endpoint accepts job_view, search, and page_view events", async () => {
  const cases = [
    { type: "job_view", job_id: "greenstone-hubspot-123", source: "live_feed" },
    { type: "search", query_text: "revenue operations", filters: { country: ["IE"] }, result_count: 5 },
    { type: "page_view", page_path: "/visa-roles", referrer: "https://google.com" }
  ];
  for (const payload of cases) {
    const response = await worker.fetch(new Request("https://example.com/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }), {});
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
  }
});

test("track endpoint rejects invalid event types", async () => {
  const response = await worker.fetch(new Request("https://example.com/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "invalid_event" })
  }), {});
  assert.equal(response.status, 400);
});

test("analytics endpoints require authentication", async () => {
  for (const path of ["/api/analytics/jobs", "/api/analytics/searches", "/api/analytics/views"]) {
    const response = await worker.fetch(new Request(`https://example.com${path}`), {});
    assert.equal(response.status, 401, `${path} should require auth`);
  }
});

test("analytics endpoints require owner allowlist", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    assert.match(String(url), /\/rest\/v1\/daily_scan_stats/);
    return Response.json([{ scan_date: "2026-06-05", total_jobs: 3 }]);
  });

  const nonOwner = createSupabaseFake({ user: { id: "00000000-0000-4000-8000-000000000040", email: "user@example.com" } });
  const denied = await worker.fetch(new Request("https://livejobindex.com/api/analytics/jobs", {
    headers: { Cookie: "session=1" }
  }), {
    SUPABASE_CLIENT: nonOwner,
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    ANALYTICS_ALLOWED_EMAILS: "owner@example.com"
  });
  assert.equal(denied.status, 403);

  const owner = createSupabaseFake({ user: { id: "00000000-0000-4000-8000-000000000041", email: "owner@example.com" } });
  const allowed = await worker.fetch(new Request("https://livejobindex.com/api/analytics/jobs", {
    headers: { Cookie: "session=1" }
  }), {
    SUPABASE_CLIENT: owner,
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    ANALYTICS_ALLOWED_EMAILS: "owner@example.com"
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { stats: [{ scan_date: "2026-06-05", total_jobs: 3 }] });
});

test("homepage render helpers escape dynamic job HTML and constrain apply URLs", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /function safeExternalURL/);
  assert.match(html, /function classToken/);
  assert.match(html, /href="\$\{escapeHTML\(safeExternalURL\(j\.apply\)\)\}"/);
  assert.match(html, /<div class="company-name">\$\{escapeHTML\(j\.company\)\}<\/div>/);
  assert.match(html, /<td class="role">\$\{escapeHTML\(j\.role\)\}<\/td>/);
  assert.match(html, /title="\$\{escapeHTML\(j\.notes \|\| ''\)\}"/);
  assert.match(html, /action: 'jobs_page_access'/);
});
