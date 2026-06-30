import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import worker, { runScan, scanSourceInventory } from "../src/worker.js";

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
  const href = String(url);
  if (href.startsWith("https://www.amazon.jobs/en/search.json")) return "amazon";
  const patterns = [
    /boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs/,
    /posting-api\/job-board\/([^/?]+)/,
    /api\.lever\.co\/v0\/postings\/([^/?]+)/,
    /api\.smartrecruiters\.com\/v1\/companies\/([^/]+)\/postings/,
    /https:\/\/([^/]+)\/wday\/cxs\/[^/]+\/[^/]+\/jobs/
  ];
  for (const pattern of patterns) {
    const match = href.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function encodeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ycJobsHtml(jobPostings = []) {
  const dataPage = {
    component: "WaasLandingPage",
    props: { jobPostings }
  };
  const encoded = encodeHtml(JSON.stringify(dataPage));
  return `<!DOCTYPE html><div data-page="${encoded}"></div>`;
}

function appleJobsHtml(searchResults = []) {
  return `<!DOCTYPE html><script>window.__APPLE_JOBS__=${JSON.stringify({ searchResults })};</script>`;
}

function netflixJobsHtml(positions = []) {
  return `<!DOCTYPE html><code id="smartApplyData">${encodeHtml(JSON.stringify({ positions }))}</code>`;
}

function emptyPayload(url) {
  if (url.includes("greenhouse")) return { jobs: [] };
  if (url.includes("ashbyhq")) return { jobs: [] };
  if (url.includes("lever.co")) return [];
  if (url.includes("smartrecruiters")) return { content: [], totalFound: 0 };
  if (url.includes("/wday/cxs/")) return { jobPostings: [], total: 0 };
  return {};
}

function mockFetch({ failedTokens = new Set(), jobsByToken = {} } = {}) {
  return async url => {
    const href = String(url);
    if (href === "https://yc-oss.github.io/api/companies/hiring.json") {
      return Response.json([]);
    }
    if (href.startsWith("https://www.ycombinator.com/jobs")) {
      return new Response(ycJobsHtml(), { headers: { "content-type": "text/html" } });
    }
    if (href.startsWith("https://www.amazon.jobs/en/search.json")) {
      if (failedTokens.has("amazon")) return new Response("failed", { status: 503 });
      return Response.json(jobsByToken.amazon || { jobs: [] });
    }
    if (href.startsWith("https://jobs.apple.com/")) {
      if (failedTokens.has("apple")) return new Response("failed", { status: 503 });
      const payload = jobsByToken.apple;
      const html = typeof payload === "string" ? payload : appleJobsHtml(payload?.searchResults || []);
      return new Response(html, { headers: { "content-type": "text/html" } });
    }
    if (href === "https://explore.jobs.netflix.net/careers") {
      if (failedTokens.has("netflix")) return new Response("failed", { status: 503 });
      const payload = jobsByToken.netflix;
      const html = typeof payload === "string" ? payload : netflixJobsHtml(payload?.positions || []);
      return new Response(html, { headers: { "content-type": "text/html" } });
    }
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

test("homepage auth buttons prefer hosted Clerk redirects before loading Clerk JS", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf("async function startClerkAuth");
  const end = html.indexOf("async function signOutClerk", start);
  const source = html.slice(start, end);

  assert.match(html, /script\.setAttribute\('data-clerk-publishable-key', CLERK_PUBLISHABLE_KEY\);/);
  assert.match(html, /const fapiDomain = atob\(CLERK_PUBLISHABLE_KEY\.split\('_'\)\[2\]\)\.slice\(0, -1\);/);
  assert.match(html, /await window\.Clerk\.load\(\);/);
  assert.match(source, /if \(!CLERK_SIGN_IN_URL && !CLERK_PUBLISHABLE_KEY\) await loadPublicConfig\(\);/);
  assert.match(source, /if \(!CLERK_SIGN_UP_URL && !CLERK_PUBLISHABLE_KEY\) await loadPublicConfig\(\);/);
  assert.ok(source.indexOf("if (CLERK_SIGN_IN_URL)") < source.lastIndexOf("const clerk = await getClerkClient();"));
  assert.ok(source.indexOf("if (CLERK_SIGN_UP_URL)") < source.indexOf("await clerk.redirectToSignUp"));
  assert.match(source, /showAuth\(err\.message \|\| 'Sign-in could not be started\. Try again\.', isProtectedRoute\(\)\);/);
});

test("homepage defaults signed-out theme to cobalt and uses icon-only header toggle", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /<html lang="en" data-theme="dark" data-brand-theme="cobalt">/);
  assert.match(html, /var brandTheme = 'cobalt'/);
  assert.match(html, /const DEFAULT_BRAND_THEME = 'cobalt'/);
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

test("homepage exposes industry switch and engineering niche controls", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /data-industry="tech">Tech<\/button>/);
  assert.match(html, /data-industry="engineering">Engineering<\/button>/);
  assert.match(html, /id="industry-switcher"[^>]*hidden/);
  assert.match(html, /const DEFAULT_INDUSTRY = 'tech'/);
  assert.match(html, /id="niche-filter" hidden/);
  assert.match(html, /const ENGINEERING_NICHES = \['AEC \/ Infrastructure'/);
  assert.match(html, /company: 'AECOM'.*niche: 'AEC \/ Infrastructure'/);
  assert.match(html, /company: 'NVIDIA'.*niche: 'Semiconductors'/);
  assert.match(html, /function setIndustry\(industry\)/);
});

test("homepage aligns deterministic search helpers and role precedence fallbacks", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /function normalizeSearchText\(value\)/);
  assert.match(html, /function searchTokens\(value\)/);
  assert.match(html, /function matchesSearchTokens\(haystack, tokens\)/);
  assert.match(html, /\['uk', 'gb'\]/);
  assert.match(html, /\['nyc', 'new york'\]/);
  assert.match(html, /\['revops', 'revenue operations'\]/);
  assert.match(html, /salesforce administrator/);
  assert.match(html, /sales operations/);
  assert.match(html, /security.*Security\/IT/s);
});

test("homepage preserves onboarding role families when relaxing profile defaults", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const relaxationSource = html.slice(
    html.indexOf("function relaxedProfileFilterStates(profile)"),
    html.indexOf("function applyProfileFiltersOnce()")
  );

  assert.match(html, /function relaxedProfileFilterStates\(profile\)/);
  assert.doesNotMatch(relaxationSource, /withoutRole/);
  assert.doesNotMatch(relaxationSource, /family:\s*new Set\(\)/);
  assert.match(relaxationSource, /const withoutSeniority = \{ \.\.\.full, seniority: new Set\(\) \};/);
  assert.match(relaxationSource, /const withoutSeniorityOrVisa = \{ \.\.\.withoutSeniority, visa: new Set\(\) \};/);
  assert.match(relaxationSource, /const withoutSeniorityVisaOrCountry = \{ \.\.\.withoutSeniorityOrVisa, country: new Set\(\) \};/);
  assert.match(relaxationSource, /return \[full, withoutSeniority, withoutSeniorityOrVisa, withoutSeniorityVisaOrCountry\];/);
  assert.match(html, /const selected = candidates\.find\(activeMatchCountForControls\) \|\| candidates\[candidates\.length - 1\];/);
  assert.match(html, /PROFILE_FILTERS_RELAXED = selected !== candidates\[0\];/);
});

test("homepage renders active pages from page-scoped server results", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const renderSource = html.slice(
    html.indexOf("function render()"),
    html.indexOf("function wireRowHandlers()")
  );

  assert.match(html, /let DYNAMIC_PAGE_IDS = \[\];/);
  assert.match(html, /function dynamicQueryKeyFromPayload\(\{ page, sort, dir, search, filters \}\)/);
  assert.match(html, /function activeServerPageReady\(\)/);
  assert.match(html, /DYNAMIC_PAGINATION_QUERY_KEY === dynamicQueryKey\(state\.page\)/);
  assert.match(html, /function dynamicPageRows\(\)/);
  assert.match(html, /DYNAMIC_PAGE_IDS\s+\.map\(id => byId\.get\(String\(id\)\)\)/);
  assert.match(renderSource, /const serverBackedActive = activeServerPageReady\(\);/);
  assert.match(renderSource, /const pageRows = serverBackedActive \? dynamicPageRows\(\) : rows\.slice\(start, start \+ PAGE_SIZE\);/);
  assert.doesNotMatch(renderSource, /serverBackedActive \? Math\.max\(rows\.length, DYNAMIC_PAGINATION\.total \|\| 0\) : rows\.length/);
});

test("homepage honors worker-clamped active pages", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const fetchSource = html.slice(
    html.indexOf("async function fetchJobsPage(page)"),
    html.indexOf("function scheduleActiveRefresh()")
  );
  const setPageSource = html.slice(
    html.indexOf("async function setPage(page)"),
    html.indexOf("function resetPage()")
  );

  assert.match(fetchSource, /const resolvedPage = DYNAMIC_PAGINATION\.page \|\| page;/);
  assert.match(fetchSource, /DYNAMIC_PAGINATION_QUERY_KEY = dynamicQueryKeyFromPayload\(\{ \.\.\.query, page: resolvedPage \}\);/);
  assert.match(fetchSource, /if \(!queryHasActiveControls\) HEADER_ACTIVE_TOTAL = DYNAMIC_PAGINATION\.total \|\| HEADER_ACTIVE_TOTAL;/);
  assert.match(fetchSource, /DYNAMIC_PAGE_IDS = \(data\.postings \|\| \[\]\)\.map\(p => String\(p\.id\)\);/);
  assert.match(setPageSource, /let target = Math\.max\(1, page\);/);
  assert.match(setPageSource, /if \(state\.tab === 'active'\)/);
  assert.match(setPageSource, /const data = await fetchJobsPage\(target\);/);
  assert.match(setPageSource, /target = data\.pagination\?\.page \|\| target;/);
  assert.match(setPageSource, /state\.page = target;/);
});

test("homepage fetches filtered startup pages without poisoning global active counts", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const initSource = html.slice(
    html.indexOf("async function init()"),
    html.indexOf("const me = ME || await loadMe()")
  );
  const tabsSource = html.slice(
    html.indexOf("function renderTabs()"),
    html.indexOf("function rowHTML(j)")
  );

  assert.match(initSource, /const needsFilteredStartupPage = hasActiveControls\(\);/);
  assert.match(initSource, /if \(!needsFilteredStartupPage\) DYNAMIC_PAGINATION_QUERY_KEY = dynamicQueryKey\(DYNAMIC_PAGINATION\.page \|\| 1\);/);
  assert.match(initSource, /if \(needsFilteredStartupPage\) \{[\s\S]*await fetchJobsPage\(1\);/);
  assert.match(initSource, /HEADER_ACTIVE_TOTAL = DYNAMIC_PAGINATION\.total \|\| data\.postings\?\.length \|\| 0;/);
  assert.match(tabsSource, /Math\.max\(buckets\.active, HEADER_ACTIVE_TOTAL\)/);
  assert.doesNotMatch(tabsSource, /DYNAMIC_PAGINATION\.total/);
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

test("runScan deterministically parses multi-location strings", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      hubspot: {
        jobs: [{
          id: 331,
          title: "Revenue Operations Manager",
          location: { name: "London / Dublin" },
          absolute_url: "https://example.com/hubspot-331"
        }, {
          id: 332,
          title: "Revenue Operations Lead",
          location: { name: "US / Canada" },
          absolute_url: "https://example.com/hubspot-332"
        }, {
          id: 333,
          title: "Revenue Operations Analyst",
          location: { name: "Singapore, Singapore" },
          absolute_url: "https://example.com/hubspot-333"
        }, {
          id: 334,
          title: "Revenue Operations Director",
          location: { name: "Remote - US" },
          absolute_url: "https://example.com/hubspot-334"
        }]
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const byId = new Map(payload.postings.map(p => [p.id, p]));

  assert.equal(byId.get("greenhouse-hubspot-331").city, "London");
  assert.equal(byId.get("greenhouse-hubspot-331").country, "GB");
  assert.equal(byId.get("greenhouse-hubspot-332").city, "United States");
  assert.equal(byId.get("greenhouse-hubspot-332").country, "US");
  assert.equal(byId.get("greenhouse-hubspot-333").city, "Singapore");
  assert.equal(byId.get("greenhouse-hubspot-333").country, "SG");
  assert.equal(byId.get("greenhouse-hubspot-334").city, "Remote - US");
  assert.equal(byId.get("greenhouse-hubspot-334").country, "US");
});

test("runScan matches expanded EU and APAC hub locations", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      hubspot: {
        jobs: [{
          id: 321,
          title: "Revenue Operations Manager",
          location: { name: "Paris, France" },
          absolute_url: "https://example.com/hubspot-321"
        }, {
          id: 322,
          title: "Sales Operations Manager",
          location: { name: "Bengaluru, India" },
          absolute_url: "https://example.com/hubspot-322"
        }, {
          id: 323,
          title: "Business Operations Manager",
          location: { name: "Taipei, Taiwan" },
          absolute_url: "https://example.com/hubspot-323"
        }, {
          id: 324,
          title: "Marketing Operations Manager",
          location: { name: "Kraków, Poland" },
          absolute_url: "https://example.com/hubspot-324"
        }, {
          id: 325,
          title: "Customer Success Manager",
          location: { name: "Seoul, South Korea" },
          absolute_url: "https://example.com/hubspot-325"
        }]
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const countries = new Map(payload.postings.map(p => [p.city, p.country]));

  assert.equal(countries.get("Paris"), "FR");
  assert.equal(countries.get("Bengaluru"), "IN");
  assert.equal(countries.get("Taipei"), "TW");
  assert.equal(countries.get("Kraków"), "PL");
  assert.equal(countries.get("Seoul"), "KR");
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

test("runScan applies ordered role classification precedence", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      canva: {
        content: [{
          id: "ops-1",
          name: "Salesforce Administrator",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "marketing-ops-1",
          name: "Product Marketing Manager",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "sales-ops-1",
          name: "Sales Operations Manager",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "security-1",
          name: "Security Engineer",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }, {
          id: "bizops-1",
          name: "Business Operations Lead",
          location: { fullLocation: "Sydney, NSW, Australia" },
          company: { identifier: "Canva" }
        }],
        totalFound: 5
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const families = new Map(payload.postings.map(p => [p.title, p.role_family]));

  assert.equal(families.get("Salesforce Administrator"), "Operations");
  assert.equal(families.get("Product Marketing Manager"), "Marketing");
  assert.equal(families.get("Sales Operations Manager"), "Operations");
  assert.equal(families.get("Security Engineer"), "Security/IT");
  assert.equal(families.get("Business Operations Lead"), "Operations");
});

test("runScan no longer live-scrapes engineering sources (workday/greenhouse-spacex/rmk/tribepad/nlx)", async t => {
  // Engineering corp ATS endpoints (corporate Workday tenants, SpaceX
  // Greenhouse, Bechtel RMK, Buro Happold Tribepad, AECOM/Stantec NLX) all
  // bot-challenge or block Cloudflare Worker egress IPs. Live scraping was
  // removed; those companies are now curated as static targets in
  // ENGINEERING_STATIC_COMPANIES in public/index.html.
  t.mock.method(globalThis, "fetch", mockFetch({}));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const sourcesSeen = new Set(payload.postings.map(p => `${p.source}-${p.source_token}`));
  for (const id of [
    "greenhouse-spacex",
    "rmk-bechtel-engineering",
    "tribepad-burohappold",
    "nlx-aecom",
    "nlx-stantec",
    "workday-intel",
    "workday-boeing",
    "workday-bostondynamics"
  ]) {
    assert.equal(sourcesSeen.has(id), false, `${id} should not be live-scraped anymore`);
  }
});

test("runScan maps Anthropic Greenhouse postings as frontier AI jobs", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      anthropic: {
        jobs: [{
          id: 7001,
          title: "Revenue Operations Manager",
          location: { name: "San Francisco, United States" },
          absolute_url: "https://boards.greenhouse.io/anthropic/jobs/7001"
        }]
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const posting = payload.postings.find(p => p.source === "greenhouse" && p.source_token === "anthropic");

  assert.ok(posting);
  assert.equal(posting.company, "anthropic");
  assert.equal(posting.niche, "AI / Frontier");
  assert.equal(posting.tier, "BigTech");
  assert.equal(posting.visa, "Strong");
  assert.equal(posting.country, "US");
});

test("runScan maps OpenAI Ashby postings as frontier AI jobs", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      openai: {
        jobs: [{
          id: "openai-ops-1",
          title: "Business Operations Manager",
          location: "London, United Kingdom",
          jobUrl: "https://jobs.ashbyhq.com/openai/openai-ops-1",
          isListed: true
        }]
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const posting = payload.postings.find(p => p.source === "ashby" && p.source_token === "openai");

  assert.ok(posting);
  assert.equal(posting.company, "openai");
  assert.equal(posting.niche, "AI / Frontier");
  assert.equal(posting.visa, "Strong");
  assert.equal(posting.role_family, "Operations");
  assert.equal(posting.country, "GB");
});

test("runScan maps Amazon search JSON postings", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      amazon: {
        jobs: [{
          id: "amz-1",
          title: "Senior Partner Manager",
          normalized_location: "London, England, United Kingdom",
          job_path: "/en/jobs/123/senior-partner-manager"
        }]
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const posting = payload.postings.find(p => p.source === "amazon");

  assert.ok(posting);
  assert.equal(posting.id, "amazon-amazon-amz-1");
  assert.equal(posting.company, "amazon");
  assert.equal(posting.title, "Senior Partner Manager");
  assert.equal(posting.location, "London, England, United Kingdom");
  assert.equal(posting.url, "https://www.amazon.jobs/en/jobs/123/senior-partner-manager");
  assert.equal(posting.country, "GB");
  assert.equal(posting.visa, "Strong");
  assert.ok(payload.scan_meta.sourceMeta["amazon-amazon"].okPages >= 1);
});

test("runScan maps Apple embedded search data with stable multi-location ids", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      apple: {
        searchResults: [{
          positionId: "200600100",
          postingTitle: "AIML - Machine Learning Engineer",
          transformedPostingTitle: "aiml-machine-learning-engineer",
          locations: [{
            postLocationId: "cupertino",
            name: "Cupertino",
            city: "Cupertino",
            stateProvince: "California",
            countryName: "United States"
          }, {
            postLocationId: "tokyo",
            name: "Tokyo",
            city: "Tokyo",
            countryName: "Japan"
          }]
        }]
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const applePostings = payload.postings.filter(p => p.source === "apple");

  assert.equal(applePostings.length, 2);
  assert.deepEqual(new Set(applePostings.map(p => p.id)), new Set([
    "apple-apple-200600100-cupertino",
    "apple-apple-200600100-tokyo"
  ]));
  assert.equal(applePostings.find(p => p.country === "US")?.city, "Cupertino");
  assert.equal(applePostings.find(p => p.country === "JP")?.city, "Tokyo");
  assert.ok(applePostings.every(p => p.url === "https://jobs.apple.com/en-us/details/200600100/aiml-machine-learning-engineer"));
  assert.ok(applePostings.every(p => p.role_family === "Engineering"));
  assert.ok(payload.scan_meta.sourceMeta["apple-apple"].okPages >= 1);
});

test("runScan maps Netflix Eightfold positions", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      netflix: {
        positions: [{
          id: "790",
          ats_job_id: "netflix-790",
          posting_name: "Partner Integration Manager",
          canonicalPositionUrl: "https://explore.jobs.netflix.net/careers/job/790",
          locations: ["Singapore, Singapore", "Amsterdam, Netherlands"]
        }]
      }
    }
  }));

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const netflixPostings = payload.postings.filter(p => p.source === "eightfold" && p.source_token === "netflix");

  assert.equal(netflixPostings.length, 2);
  assert.deepEqual(new Set(netflixPostings.map(p => p.id)), new Set([
    "eightfold-netflix-790-0",
    "eightfold-netflix-790-1"
  ]));
  assert.ok(netflixPostings.every(p => p.company === "netflix"));
  assert.ok(netflixPostings.every(p => p.url === "https://explore.jobs.netflix.net/careers/job/790"));
  assert.equal(netflixPostings.find(p => p.country === "SG")?.city, "Singapore");
  assert.equal(netflixPostings.find(p => p.country === "NL")?.city, "Amsterdam");
  assert.equal(payload.scan_meta.sourceMeta["eightfold-netflix"].parsedCount, 1);
});

test("engineering source inventory no longer includes bot-protected live engineering sources", () => {
  // Live engineering scraping was removed because corporate Workday tenants,
  // SpaceX Greenhouse, Bechtel RMK, Buro Happold Tribepad, and AECOM/Stantec
  // NLX all bot-challenge Cloudflare Worker egress. Those companies are now
  // curated as static targets in public/index.html instead.
  const inventory = scanSourceInventory();
  const ids = new Set(inventory.map(source => source.id));

  for (const id of [
    "greenhouse-spacex",
    "rmk-bechtel-engineering",
    "tribepad-burohappold",
    "nlx-aecom",
    "nlx-stantec",
    "workday-intel",
    "workday-boeing",
    "workday-bostondynamics"
  ]) {
    assert.equal(ids.has(id), false, `${id} should no longer be a live source`);
  }
});

test("popular tech source inventory includes new live sources and classification metadata", () => {
  const inventory = scanSourceInventory();
  const byId = new Map(inventory.map(source => [source.id, source]));

  assert.deepEqual(byId.get("greenhouse-anthropic"), {
    id: "greenhouse-anthropic",
    source: "greenhouse",
    token: "anthropic",
    company: "anthropic",
    industry: "tech",
    niche: "AI / Frontier",
    tier: "BigTech",
    visa: "Strong"
  });
  assert.deepEqual(byId.get("ashby-openai"), {
    id: "ashby-openai",
    source: "ashby",
    token: "openai",
    company: "openai",
    industry: "tech",
    niche: "AI / Frontier",
    tier: "BigTech",
    visa: "Strong"
  });
  assert.deepEqual(byId.get("amazon-amazon"), {
    id: "amazon-amazon",
    source: "amazon",
    token: "amazon",
    company: "amazon",
    industry: "tech",
    niche: "Software",
    tier: "BigTech",
    visa: "Strong"
  });
  assert.deepEqual(byId.get("apple-apple"), {
    id: "apple-apple",
    source: "apple",
    token: "apple",
    company: "apple",
    industry: "tech",
    niche: "Hardware / Consumer Devices",
    tier: "BigTech",
    visa: "Strong"
  });
  assert.deepEqual(byId.get("eightfold-netflix"), {
    id: "eightfold-netflix",
    source: "eightfold",
    token: "netflix",
    company: "netflix",
    industry: "tech",
    niche: "Software",
    tier: "BigTech",
    visa: "Likely"
  });
});

test("runScan maps broad YC startup jobs from data-page HTML", async t => {
  const ycJobs = [{
    id: 93960,
    title: "Revenue Operations Manager",
    url: "/companies/coast/jobs/revops-manager",
    location: "SF",
    askUs: false,
    role: "operations",
    prettyRole: "Operations",
    visa: "Will sponsor",
    companyUrl: "/companies/coast",
    companyName: "Coast"
  }];

  t.mock.method(globalThis, "fetch", async url => {
    const href = String(url);
    if (href === "https://yc-oss.github.io/api/companies/hiring.json") {
      return Response.json([{
        slug: "coast",
        name: "Coast",
        all_locations: "New York, NY, USA",
        team_size: 35,
        industry: "B2B",
        stage: "Early",
        tags: ["SaaS", "API"]
      }]);
    }
    if (href === "https://www.ycombinator.com/jobs") {
      return new Response(ycJobsHtml(ycJobs), { headers: { "content-type": "text/html" } });
    }
    if (href.startsWith("https://www.ycombinator.com/jobs")) {
      return new Response(ycJobsHtml(), { headers: { "content-type": "text/html" } });
    }
    const token = tokenFromUrl(href);
    return Response.json(token ? emptyPayload(href) : {});
  });

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const posting = payload.postings.find(p => p.source === "yc");

  assert.ok(posting);
  assert.equal(posting.id, "yc-yc-waas-93960");
  assert.equal(posting.source_token, "yc-waas");
  assert.equal(posting.company, "Coast");
  assert.equal(posting.city, "San Francisco");
  assert.equal(posting.country, "US");
  assert.equal(posting.role_family, "Operations");
  assert.equal(posting.visa, "Strong");
  assert.equal(posting.tier, "GrowthSaaS");
  assert.equal(posting.url, "https://www.ycombinator.com/companies/coast/jobs/revops-manager");
  assert.ok(payload.scan_meta.sourceMeta["yc-yc-waas"].okPages >= 1);
});

test("runScan deduplicates YC jobs and maps YC visa/location variants", async t => {
  const ycJobs = [{
    id: 1,
    title: "Senior Software Engineer",
    url: "/companies/gogograndparent/jobs/backend",
    location: "Remote",
    askUs: false,
    prettyRole: "Engineering",
    visa: "US citizenship/visa not required",
    companyUrl: "/companies/gogograndparent",
    companyName: "GoGoGrandparent"
  }, {
    id: 2,
    title: "Staff Software Engineer, Infrastructure",
    url: "/companies/numero/jobs/infrastructure",
    location: "US / Remote (US)",
    askUs: false,
    prettyRole: "Engineering",
    visa: "US citizen/visa only",
    companyUrl: "/companies/numero",
    companyName: "Numero"
  }, {
    id: 3,
    title: "Strategic Accounts",
    url: "/companies/coast/jobs/strategic-accounts",
    location: "NYC, NY, US",
    askUs: true,
    prettyRole: "Sales",
    visa: "",
    companyUrl: "/companies/coast",
    companyName: "Coast"
  }];

  t.mock.method(globalThis, "fetch", async url => {
    const href = String(url);
    if (href === "https://yc-oss.github.io/api/companies/hiring.json") {
      return Response.json([{
        slug: "gogograndparent",
        name: "GoGoGrandparent",
        all_locations: "San Francisco, CA, USA; Remote",
        team_size: 50,
        industry: "Consumer",
        stage: "Early",
        tags: []
      }, {
        slug: "numero",
        name: "Numero",
        all_locations: "San Francisco, CA, USA",
        team_size: 220,
        industry: "B2B",
        stage: "Growth",
        tags: ["Fintech"]
      }, {
        slug: "coast",
        name: "Coast",
        all_locations: "New York, NY, USA",
        team_size: 35,
        industry: "B2B",
        stage: "Early",
        tags: ["SaaS"]
      }]);
    }
    if (href === "https://www.ycombinator.com/jobs") {
      return new Response(ycJobsHtml(ycJobs), { headers: { "content-type": "text/html" } });
    }
    if (href.endsWith("/jobs/role/software-engineer")) {
      return new Response(ycJobsHtml([ycJobs[0], ycJobs[1]]), { headers: { "content-type": "text/html" } });
    }
    if (href.startsWith("https://www.ycombinator.com/jobs")) {
      return new Response(ycJobsHtml(), { headers: { "content-type": "text/html" } });
    }
    const token = tokenFromUrl(href);
    return Response.json(token ? emptyPayload(href) : {});
  });

  const KV = createKV();
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const ycPostings = payload.postings.filter(p => p.source === "yc");

  assert.equal(ycPostings.length, 3);
  assert.equal(ycPostings.find(p => p.id === "yc-yc-waas-1").visa, "Likely");
  assert.equal(ycPostings.find(p => p.id === "yc-yc-waas-1").city, "San Francisco");
  assert.equal(ycPostings.find(p => p.id === "yc-yc-waas-2").visa, "Unknown");
  assert.equal(ycPostings.find(p => p.id === "yc-yc-waas-2").country, "US");
  assert.equal(ycPostings.find(p => p.id === "yc-yc-waas-2").tier, "Scaleup");
  assert.equal(ycPostings.find(p => p.id === "yc-yc-waas-3").visa, "Likely");
  assert.equal(ycPostings.find(p => p.id === "yc-yc-waas-3").city, "New York");
  assert.equal(ycPostings.find(p => p.id === "yc-yc-waas-3").role_family, "Sales");
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

function createD1Fake({ user, rows = {} } = {}) {
  const calls = [];
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
    anonymous_sessions: [],
    job_views: [],
    search_queries: [],
    page_views: [],
    ...rows
  };

  function clone(row) {
    return row ? { ...row } : row;
  }

  function upsert(table, row, conflictCols, { ignore = false } = {}) {
    calls.push({ table, action: "upsert", payload: clone(row), options: { conflictCols, ignore } });
    const existing = data[table].find(item => conflictCols.every(col => item[col] === row[col]));
    if (existing) {
      if (!ignore) Object.assign(existing, row);
      return existing;
    }
    data[table].push(row);
    return row;
  }

  function insert(table, row) {
    calls.push({ table, action: "insert", payload: clone(row) });
    data[table].push(row);
    return row;
  }

  function update(table, payload, predicate) {
    calls.push({ table, action: "update", payload: clone(payload) });
    for (const row of data[table]) {
      if (predicate(row)) Object.assign(row, payload);
    }
  }

  function run(sql, params) {
    const q = sql.toLowerCase().replace(/\s+/g, " ").trim();
    if (q.startsWith("insert into users")) {
      const [id, email, full_name, account_type, created_at, updated_at] = params;
      const existing = data.users.find(row => row.id === id);
      if (existing) {
        existing.email = email;
        if (full_name) existing.full_name = full_name;
        existing.updated_at = updated_at;
        calls.push({ table: "users", action: "upsert", payload: clone(existing) });
      } else {
        upsert("users", {
          id,
          email,
          full_name,
          last_login_at: null,
          onboarding_completed: 0,
          account_type,
          brand_theme: "cobalt",
          created_at,
          updated_at
        }, ["id"]);
      }
    } else if (q.startsWith("update users set last_login_at")) {
      const [last_login_at, email, updated_at, id] = params;
      update("users", { last_login_at, email, updated_at }, row => row.id === id);
    } else if (q.startsWith("update users set account_type")) {
      const [account_type, updated_at, id] = params;
      update("users", { account_type, onboarding_completed: 0, updated_at }, row => row.id === id);
    } else if (q.startsWith("update users set onboarding_completed")) {
      const [updated_at, id] = params;
      update("users", { onboarding_completed: 1, updated_at }, row => row.id === id);
    } else if (q.startsWith("update users set brand_theme")) {
      const [brand_theme, updated_at, id] = params;
      update("users", { brand_theme, updated_at }, row => row.id === id);
    } else if (q.startsWith("insert into account_access")) {
      const [user_id, account_type, export_enabled, created_at, updated_at] = params;
      const row = {
        user_id,
        plan: "free",
        account_type,
        api_access_enabled: 0,
        integrations_enabled: 0,
        export_enabled,
        rate_limit_tier: "free",
        created_at,
        updated_at
      };
      if (q.includes("do nothing")) upsert("account_access", row, ["user_id"], { ignore: true });
      else upsert("account_access", row, ["user_id"]);
    } else if (q.startsWith("insert into user_profiles")) {
      const [user_id, full_name, current_title, years_experience, target_role_families, target_seniority, target_countries, visa_needed, preferred_work_mode, salary_min_usd, linkedin_url, resume_url, created_at, updated_at] = params;
      upsert("user_profiles", { user_id, full_name, current_title, years_experience, target_role_families, target_seniority, target_countries, visa_needed, preferred_work_mode, salary_min_usd, linkedin_url, resume_url, created_at, updated_at }, ["user_id"]);
    } else if (q.startsWith("insert into agency_profiles")) {
      const [user_id, agency_name, agency_type, target_markets, target_role_families, target_countries, use_case, integration_interest, monthly_data_volume, created_at, updated_at] = params;
      upsert("agency_profiles", { user_id, agency_name, agency_type, target_markets, target_role_families, target_countries, use_case, integration_interest, monthly_data_volume, created_at, updated_at }, ["user_id"]);
    } else if (q.startsWith("insert into user_activity")) {
      const [id, user_id, event_type, entity_type, entity_id, metadata, created_at] = params;
      insert("user_activity", { id, user_id, event_type, entity_type, entity_id, metadata, created_at });
    } else if (q.startsWith("insert into agency_feedback")) {
      const [id, user_id, agency_name, message, metadata, created_at] = params;
      insert("agency_feedback", { id, user_id, agency_name, message, metadata, created_at });
    } else if (q.startsWith("insert into user_jobs")) {
      const [id, user_id, job_id, status, starred, notes, applied_at, saved_at, archived_at, viewed_at, created_at, updated_at] = params;
      upsert("user_jobs", { id, user_id, job_id, status, starred, notes, applied_at, saved_at, archived_at, viewed_at, created_at, updated_at }, ["user_id", "job_id"]);
    } else if (q.startsWith("insert into user_job_history")) {
      const [id, user_id, job_id, event_type, from_status, to_status, created_at] = params;
      insert("user_job_history", { id, user_id, job_id, event_type, from_status, to_status, created_at });
    } else if (q.startsWith("insert into anonymous_sessions")) {
      const [id, session_token, created_at, last_seen_at] = params;
      upsert("anonymous_sessions", { id, session_token, ip_hash: null, user_agent_fingerprint: null, created_at, last_seen_at }, ["session_token"]);
    } else if (q.startsWith("insert into job_views")) {
      const [user_id, session_id, job_id, source, viewed_at] = params;
      insert("job_views", { id: data.job_views.length + 1, user_id, session_id, job_id, source, viewed_at });
    } else if (q.startsWith("insert into search_queries")) {
      const [user_id, session_id, query_text, filters, result_count, created_at] = params;
      insert("search_queries", { id: data.search_queries.length + 1, user_id, session_id, query_text, filters, result_count, created_at });
    } else if (q.startsWith("insert into page_views")) {
      const [user_id, session_id, page_path, referrer, created_at] = params;
      insert("page_views", { id: data.page_views.length + 1, user_id, session_id, page_path, referrer, created_at });
    } else if (q.startsWith("insert into job_postings")) {
      const [id, source, source_token, company, title, url, industry, niche, first_seen_date, last_seen_date, last_filled_date, is_active, created_at, updated_at] = params;
      upsert("job_postings", { id, source, source_token, company, title, url, industry, niche, first_seen_date, last_seen_date, last_filled_date, is_active, created_at, updated_at }, ["id"]);
    } else if (q.startsWith("insert into job_snapshots")) {
      const [job_id, scan_date, title, location, city, country, industry, niche, role_family, seniority, visa, score, tier, is_new, is_filled, created_at] = params;
      upsert("job_snapshots", { id: data.job_snapshots.length + 1, job_id, scan_date, title, location, city, country, industry, niche, role_family, seniority, visa, score, tier, is_new, is_filled, created_at }, ["job_id", "scan_date"]);
    } else if (q.startsWith("insert into daily_scan_stats")) {
      const [scan_date, total_jobs, new_jobs, filled_jobs, per_source, per_industry, per_niche, per_country, per_family, per_tier, ok_count, fail_count, created_at, updated_at] = params;
      upsert("daily_scan_stats", { scan_date, total_jobs, new_jobs, filled_jobs, per_source, per_industry, per_niche, per_country, per_family, per_tier, ok_count, fail_count, created_at, updated_at }, ["scan_date"]);
    } else {
      throw new Error(`Unhandled D1 run: ${sql}`);
    }
    return { success: true };
  }

  function select(sql, params) {
    const q = sql.toLowerCase().replace(/\s+/g, " ").trim();
    let rows;
    if (q === "select * from users where id = ?") {
      rows = data.users.filter(row => row.id === params[0]);
    } else if (q === "select * from user_profiles where user_id = ?") {
      rows = data.user_profiles.filter(row => row.user_id === params[0]);
    } else if (q === "select * from agency_profiles where user_id = ?") {
      rows = data.agency_profiles.filter(row => row.user_id === params[0]);
    } else if (q === "select * from account_access where user_id = ?") {
      rows = data.account_access.filter(row => row.user_id === params[0]);
    } else if (q === "select * from user_jobs where user_id = ? order by updated_at desc") {
      rows = data.user_jobs.filter(row => row.user_id === params[0]).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    } else if (q === "select * from user_jobs where user_id = ? and job_id = ?") {
      rows = data.user_jobs.filter(row => row.user_id === params[0] && row.job_id === params[1]);
    } else if (q === "select * from user_job_history where user_id = ? and job_id = ? order by created_at desc") {
      rows = data.user_job_history.filter(row => row.user_id === params[0] && row.job_id === params[1]).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    } else if (q === "select * from daily_scan_stats where scan_date >= ? order by scan_date desc") {
      rows = data.daily_scan_stats.filter(row => row.scan_date >= params[0]).sort((a, b) => String(b.scan_date || "").localeCompare(String(a.scan_date || "")));
    } else if (q === "select * from search_queries where created_at >= ? order by created_at desc") {
      rows = data.search_queries.filter(row => row.created_at >= params[0]).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    } else if (q === "select * from job_views where viewed_at >= ? order by viewed_at desc") {
      rows = data.job_views.filter(row => row.viewed_at >= params[0]).sort((a, b) => String(b.viewed_at || "").localeCompare(String(a.viewed_at || "")));
    } else {
      throw new Error(`Unhandled D1 select: ${sql}`);
    }
    return rows.map(clone);
  }

  return {
    calls,
    rows: data,
    user,
    DB: {
      prepare(sql) {
        return {
          sql,
          params: [],
          bind(...params) {
            this.params = params;
            return this;
          },
          run() {
            return Promise.resolve(run(this.sql, this.params));
          },
          first() {
            return Promise.resolve(select(this.sql, this.params)[0] || null);
          },
          all() {
            return Promise.resolve({ results: select(this.sql, this.params) });
          }
        };
      },
      batch(statements) {
        return Promise.all(statements.map(statement => statement.run()));
      }
    },
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

test("public jobs endpoint filters by industry query parameter", async () => {
  const KV = createKV();
  const tech = { ...samplePostings(1)[0], id: "tech-1", industry: "tech", niche: "Software" };
  const engineering = {
    ...samplePostings(1)[0],
    id: "eng-1",
    company: "AECOM",
    title: "Senior Structural Engineer",
    industry: "engineering",
    niche: "AEC / Infrastructure",
    role_family: "Engineering"
  };
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: [tech, engineering] }));

  const response = await worker.fetch(new Request("https://example.com/api/jobs?industry=engineering"), { KV });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.pagination.total, 1);
  assert.equal(payload.postings[0].id, "eng-1");
  assert.equal(payload.postings[0].industry, "engineering");
  assert.equal(payload.postings[0].niche, "AEC / Infrastructure");
});

test("public jobs endpoint schedules stale payload refresh", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    jobsByToken: {
      hubspot: {
        jobs: [{
          id: 101,
          title: "Revenue Operations Manager",
          location: { name: "Dublin, Ireland" },
          absolute_url: "https://example.com/hubspot-101"
        }]
      }
    }
  }));

  const KV = createKV({ postings: {} }, {
    last_scan: "2000-01-01",
    last_scan_at: "2000-01-01T00:00:00.000Z",
    postings: samplePostings(1)
  });
  const waitUntil = [];

  const response = await worker.fetch(new Request("https://example.com/api/jobs"), { KV }, {
    waitUntil(promise) {
      waitUntil.push(promise);
    }
  });

  assert.equal(response.status, 200);
  assert.equal(waitUntil.length, 1);
  assert.ok(KV.puts.some(p => p.key === "scan:stale-refresh-lock"));

  await Promise.all(waitUntil);

  const jobsPut = KV.puts.findLast(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  assert.equal(payload.last_scan, new Date().toISOString().slice(0, 10));
  assert.ok(payload.postings.some(p => p.id === "greenhouse-hubspot-101"));
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

test("jobs query filters engineering postings by niche", async () => {
  const KV = createKV();
  const postings = [
    { ...samplePostings(1)[0], id: "tech-1", industry: "tech", niche: "Software" },
    {
      ...samplePostings(1)[0],
      id: "eng-aec",
      company: "WSP",
      title: "Senior Transport Engineer",
      industry: "engineering",
      niche: "AEC / Infrastructure",
      role_family: "Engineering"
    },
    {
      ...samplePostings(1)[0],
      id: "eng-semi",
      company: "NVIDIA",
      title: "Hardware Engineer",
      industry: "engineering",
      niche: "Semiconductors",
      role_family: "Engineering"
    }
  ];
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings }));

  const response = await worker.fetch(new Request("https://example.com/api/jobs/query", {
    method: "POST",
    body: JSON.stringify({
      page: 1,
      filters: { industry: ["engineering"], niche: ["Semiconductors"] }
    })
  }), { KV });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.pagination.total, 1);
  assert.equal(payload.postings[0].id, "eng-semi");
});

test("jobs query applies deterministic search aliases and all-token matching", async () => {
  const KV = createKV();
  const postings = [
    {
      ...samplePostings(1)[0],
      id: "gb-revops",
      company: "HubSpot",
      title: "Revenue Operations Manager",
      country: "GB",
      city: "London",
      location: "London, United Kingdom",
      role_family: "Operations"
    },
    {
      ...samplePostings(1)[0],
      id: "nyc-bizops",
      company: "Cursor",
      title: "Business Operations Lead",
      country: "US",
      city: "New York",
      location: "New York, United States",
      role_family: "Operations"
    },
    {
      ...samplePostings(1)[0],
      id: "sf-gtm",
      company: "OpenAI",
      title: "GTM Operations Manager",
      country: "US",
      city: "San Francisco",
      location: "San Francisco, United States",
      role_family: "Operations"
    }
  ];
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings }));

  const cases = [
    ["uk revops", "gb-revops"],
    ["united kingdom revenue operations", "gb-revops"],
    ["nyc bizops", "nyc-bizops"],
    ["sf gtm ops", "sf-gtm"]
  ];

  for (const [search, expectedId] of cases) {
    const response = await worker.fetch(new Request("https://example.com/api/jobs/query", {
      method: "POST",
      body: JSON.stringify({ page: 1, search })
    }), { KV });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.pagination.total, 1, search);
    assert.equal(payload.postings[0].id, expectedId, search);
  }
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

test("jobs query allows authenticated page two without human verification", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000020", email: "king@example.com" };
  const fake = createD1Fake({ user });
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(20) }));

  const response = await worker.fetch(new Request("https://example.com/api/jobs/query", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ page: 2 })
  }), {
    KV,
    DB: fake.DB, CLERK_USER: fake.user
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.pagination.page, 2);
  assert.equal(payload.postings.length, 5);
});

test("jobs query clamps out-of-range pages", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000022", email: "king@example.com" };
  const fake = createD1Fake({ user });
  const KV = createKV();
  await KV.put("jobs", JSON.stringify({ last_scan: "2026-06-02", postings: samplePostings(20) }));

  const response = await worker.fetch(new Request("https://example.com/api/jobs/query", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ page: 99 })
  }), {
    KV,
    DB: fake.DB, CLERK_USER: fake.user
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
  const fake = createD1Fake({
    user,
    rows: {
      users: [{ id: user.id, email: user.email, account_type: "individual", onboarding_completed: false }],
      account_access: [{ user_id: user.id, account_type: "individual", plan: "free" }]
    }
  });

  const response = await worker.fetch(new Request("https://example.com/api/onboarding/complete", {
    method: "POST",
    headers: { Cookie: "session=1" }
  }), { KV: createKV(), DB: fake.DB, CLERK_USER: fake.user });

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
  const individualFake = createD1Fake({
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
  const incompleteAgencyFake = createD1Fake({
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
  }), { KV: createKV(), DB: individualFake.DB, CLERK_USER: individualFake.user });
  const incompleteResponse = await worker.fetch(new Request("https://example.com/api/agency-feedback", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ message: "Need an API." })
  }), { KV: createKV(), DB: incompleteAgencyFake.DB, CLERK_USER: incompleteAgencyFake.user });

  assert.equal(individualResponse.status, 403);
  assert.equal(incompleteResponse.status, 403);
});

test("agency feedback validates message length", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000033", email: "agency@example.com" };
  const fake = createD1Fake({
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
  }), { KV: createKV(), DB: fake.DB, CLERK_USER: fake.user });
  const longResponse = await worker.fetch(new Request("https://example.com/api/agency-feedback", {
    method: "POST",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ message: "x".repeat(2001) })
  }), { KV: createKV(), DB: fake.DB, CLERK_USER: fake.user });

  assert.equal(blankResponse.status, 400);
  assert.equal((await blankResponse.json()).error, "message is required");
  assert.equal(longResponse.status, 400);
  assert.equal((await longResponse.json()).error, "message must be 2000 characters or fewer");
});

test("agency feedback saves completed agency feedback with profile metadata", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000034", email: "agency@example.com" };
  const fake = createD1Fake({
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
  }), { KV: createKV(), DB: fake.DB, CLERK_USER: fake.user });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  const feedbackCall = fake.calls.find(item => item.table === "agency_feedback" && item.action === "insert");
  assert.equal(feedbackCall.payload.user_id, user.id);
  assert.equal(feedbackCall.payload.agency_name, "Lead Forge");
  assert.equal(feedbackCall.payload.message, "Please add API keys and Clay export support.");
  assert.deepEqual(JSON.parse(feedbackCall.payload.metadata), {
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
    full_name: "Sohaib Kazmi"
  };
  const fake = createD1Fake({ user });

  const response = await worker.fetch(new Request("https://example.com/api/me", {
    headers: { Cookie: "session=1" }
  }), { KV: createKV(), DB: fake.DB, CLERK_USER: fake.user });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.auth_user.full_name, "Sohaib Kazmi");
});

test("public config exposes browser auth settings", async () => {
  const response = await worker.fetch(new Request("https://livejobindex.com/api/config"), {
    CLERK_PUBLISHABLE_KEY: "pk_test_livejobindex",
    CLERK_SIGN_IN_URL: "https://accounts.livejobindex.com/sign-in",
    CLERK_SIGN_UP_URL: "https://accounts.livejobindex.com/sign-up"
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const payload = await response.json();
  assert.deepEqual(payload, {
    clerk_publishable_key: "pk_test_livejobindex",
    clerk_sign_in_url: "https://accounts.livejobindex.com/sign-in",
    clerk_sign_up_url: "https://accounts.livejobindex.com/sign-up"
  });
});

test("legacy google auth route redirects to Clerk sign-in", async () => {
  const response = await worker.fetch(new Request("https://livejobindex.com/api/auth/google?next=/profile"), {
    KV: createKV(),
    CLERK_SIGN_IN_URL: "https://accounts.livejobindex.com/sign-in"
  });

  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("Location"));
  assert.equal(location.origin + location.pathname, "https://accounts.livejobindex.com/sign-in");
  assert.equal(location.searchParams.get("redirect_url"), "https://livejobindex.com/profile");
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

test("legacy auth session bridge is gone", async () => {
  const response = await worker.fetch(new Request("https://livejobindex.com/api/auth/session", {
    method: "POST",
    body: JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token" })
  }), { KV: createKV() });

  assert.equal(response.status, 410);
  const payload = await response.json();
  assert.equal(payload.error, "clerk_auth_required");
});

test("complete onboarding requires an agency profile for agency accounts", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000002", email: "agency@example.com" };
  const fake = createD1Fake({
    user,
    rows: {
      users: [{ id: user.id, email: user.email, account_type: "agency", onboarding_completed: false }],
      account_access: [{ user_id: user.id, account_type: "agency", plan: "free" }]
    }
  });

  const response = await worker.fetch(new Request("https://example.com/api/onboarding/complete", {
    method: "POST",
    headers: { Cookie: "session=1" }
  }), { KV: createKV(), DB: fake.DB, CLERK_USER: fake.user });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "agency profile is required");
});

test("user job upsert stores status, star, and derived timestamps", async () => {
  const user = { id: "00000000-0000-4000-8000-000000000003", email: "king@example.com" };
  const fake = createD1Fake({ user });

  const response = await worker.fetch(new Request("https://example.com/api/user-jobs/greenhouse-hubspot-101", {
    method: "PUT",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ status: "Applied", starred: true, notes: "High fit" })
  }), { KV: createKV(), DB: fake.DB, CLERK_USER: fake.user });

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
  const fake = createD1Fake({
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
  }), { KV: createKV(), DB: fake.DB, CLERK_USER: fake.user });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.brand_theme, "aurora");
  assert.ok(fake.calls.some(item => item.table === "users" && item.action === "update" && item.payload.brand_theme === "aurora"));
  assert.ok(fake.calls.some(item => item.table === "user_activity" && item.action === "insert" && item.payload.event_type === "settings_updated"));

  const invalid = await worker.fetch(new Request("https://example.com/api/settings", {
    method: "PATCH",
    headers: { Cookie: "session=1" },
    body: JSON.stringify({ brand_theme: "sepia" })
  }), { KV: createKV(), DB: fake.DB, CLERK_USER: fake.user });

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
  assert.equal(payload.scan_meta.sourceMeta["greenhouse-hubspot"].fetchFailures[0].reason, "http_error");
  assert.equal(payload.scan_meta.sourceMeta["greenhouse-hubspot"].fetchFailures[0].status, 503);
});

test("runScan preserves previous postings when a custom parser source fails", async t => {
  t.mock.method(globalThis, "fetch", mockFetch({
    failedTokens: new Set(["netflix"])
  }));

  const previousPosting = {
    id: "eightfold-netflix-790-0",
    source: "eightfold",
    source_token: "netflix",
    company: "netflix",
    title: "Partner Integration Manager",
    location: "Singapore, Singapore",
    city: "Singapore",
    country: "SG",
    url: "https://explore.jobs.netflix.net/careers/job/790",
    tier: "BigTech",
    industry: "tech",
    niche: "Software",
    role_family: "Sales",
    seniority: "Manager",
    visa: "Likely",
    score: 88,
    first_seen: "2026-05-20",
    last_seen: "2026-05-20",
    last_filled: null
  };
  const KV = createKV({ postings: { [previousPosting.id]: previousPosting } });
  const result = await runScan({ KV });
  assert.equal(result.error, undefined);

  const jobsPut = KV.puts.find(p => p.key === "jobs");
  const payload = JSON.parse(jobsPut.value);
  const posting = payload.postings.find(p => p.id === previousPosting.id);

  assert.ok(posting);
  assert.equal(posting.last_filled, null);
  assert.ok(payload.scan_meta.failedSources.includes("eightfold-netflix"));
});

test("runScan preserves previous YC postings when YC seed pages partially fail", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    const href = String(url);
    if (href === "https://yc-oss.github.io/api/companies/hiring.json") {
      return Response.json([]);
    }
    if (href === "https://www.ycombinator.com/jobs/role/operations") {
      return new Response("failed", { status: 503 });
    }
    if (href.startsWith("https://www.ycombinator.com/jobs")) {
      return new Response(ycJobsHtml(), { headers: { "content-type": "text/html" } });
    }
    const token = tokenFromUrl(href);
    return Response.json(token ? emptyPayload(href) : {});
  });

  const previousPosting = {
    id: "yc-yc-waas-42",
    source: "yc",
    source_token: "yc-waas",
    company: "Coast",
    title: "Revenue Operations Lead",
    location: "San Francisco",
    city: "San Francisco",
    country: "US",
    url: "https://www.ycombinator.com/companies/coast/jobs/revops",
    tier: "GrowthSaaS",
    industry: "tech",
    niche: "Software",
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
  const posting = payload.postings.find(p => p.id === previousPosting.id);

  assert.ok(posting);
  assert.equal(posting.last_filled, null);
  assert.deepEqual(payload.scan_meta.sourceMeta["yc-yc-waas"].failedPages, ["/jobs/role/operations"]);
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

test("manual scan persists D1 analytics", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    const href = String(url);
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
  const fake = createD1Fake();
  const waitUntil = [];
  const response = await worker.fetch(new Request("https://example.com/api/scan-now", {
    headers: { "X-Scan-Key": "scan-secret" }
  }), {
    KV,
    SCAN_KEY: "scan-secret",
    DB: fake.DB
  }, {
    waitUntil(promise) {
      waitUntil.push(promise);
    }
  });

  assert.equal(response.status, 200);
  await Promise.all(waitUntil);

  assert.ok(fake.rows.job_postings.length > 0);
  assert.ok(fake.rows.job_snapshots.length > 0);
  assert.equal(fake.rows.job_postings[0].industry, "tech");
  assert.equal(fake.rows.job_postings[0].niche, "Software");
  assert.equal(fake.rows.job_snapshots[0].industry, "tech");
  assert.equal(fake.rows.job_snapshots[0].niche, "Software");
  const stats = fake.rows.daily_scan_stats[0];
  assert.equal(JSON.parse(stats.per_industry).tech, 1);
  assert.equal(JSON.parse(stats.per_niche).Software, 1);
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

test("analytics endpoints require owner allowlist", async () => {
  const nonOwner = createD1Fake({ user: { id: "00000000-0000-4000-8000-000000000040", email: "user@example.com" } });
  const denied = await worker.fetch(new Request("https://livejobindex.com/api/analytics/jobs", {
    headers: { Cookie: "session=1" }
  }), {
    DB: nonOwner.DB, CLERK_USER: nonOwner.user,
    ANALYTICS_ALLOWED_EMAILS: "owner@example.com"
  });
  assert.equal(denied.status, 403);

  const owner = createD1Fake({
    user: { id: "00000000-0000-4000-8000-000000000041", email: "owner@example.com" },
    rows: {
      daily_scan_stats: [{
        scan_date: "2026-06-05",
        total_jobs: 3,
        per_source: "{}",
        per_industry: "{}",
        per_niche: "{}",
        per_country: "{}",
        per_family: "{}",
        per_tier: "{}"
      }]
    }
  });
  const allowed = await worker.fetch(new Request("https://livejobindex.com/api/analytics/jobs", {
    headers: { Cookie: "session=1" }
  }), {
    DB: owner.DB, CLERK_USER: owner.user,
    ANALYTICS_ALLOWED_EMAILS: "owner@example.com"
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), {
    stats: [{
      scan_date: "2026-06-05",
      total_jobs: 3,
      per_source: {},
      per_industry: {},
      per_niche: {},
      per_country: {},
      per_family: {},
      per_tier: {}
    }]
  });
});

test("homepage render helpers escape dynamic job HTML and constrain apply URLs", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /function safeExternalURL/);
  assert.match(html, /function classToken/);
  assert.match(html, /href="\$\{escapeHTML\(safeExternalURL\(j\.apply\)\)\}"/);
  assert.match(html, /<div class="company-name">\$\{escapeHTML\(j\.company\)\}<\/div>/);
  assert.match(html, /<td class="role">\$\{escapeHTML\(j\.role\)\}<\/td>/);
  assert.match(html, /title="\$\{escapeHTML\(j\.notes \|\| ''\)\}"/);
  assert.doesNotMatch(html, /jobs_page_access/);
});
