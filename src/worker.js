import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";

// Cloudflare Worker — Job Tracker
// Serves the static HTML and exposes /api/jobs (KV-backed).
// Cron handler (0 3 * * * UTC = 7 AM Dubai) scans supported ATS APIs daily.

const GREENHOUSE_TOKENS = [
  "gongio", "klaviyo", "datadog", "cloudflare", "hubspot",
  "pleo", "celonis", "airtable", "gitlab", "figma",
  "brex", "mercury", "vercel", "typeform", "feedzai",
  "mentimeter", "trustpilot", "twilio", "asana",
  "databricks", "mongodb", "elastic", "remote",
  "sumologic", "contentful", "n26", "cognite",
  "talkdesk2", "boxinc"
];

const ASHBY_TOKENS = [
  "confluent", "deel", "linear", "mollie",
  "notion", "ramp", "snowflake", "xero"
];

const LEVER_TOKENS = ["pipedrive"];

const SMARTRECRUITERS_TOKENS = ["canva", "wise"];
const ACTIVE_SOURCES = new Set(["greenhouse", "ashby", "lever", "smartrecruiters"]);
const FAILURE_ABORT_RATIO = 0.5;

const CITY_TO_COUNTRY = {
  "London": "GB", "Manchester": "GB", "Edinburgh": "GB",
  "Dublin": "IE", "Cork": "IE",
  "Toronto": "CA", "Vancouver": "CA", "Montreal": "CA",
  "Sydney": "AU", "Melbourne": "AU",
  "Singapore": "SG",
  "Berlin": "DE", "Munich": "DE", "Hamburg": "DE", "Frankfurt": "DE",
  "Amsterdam": "NL", "Rotterdam": "NL",
  "Zurich": "CH", "Geneva": "CH",
  "Stockholm": "SE",
  "Copenhagen": "DK", "Aarhus": "DK",
  "Oslo": "NO",
  "Barcelona": "ES", "Madrid": "ES",
  "Lisbon": "PT", "Porto": "PT",
  "Tallinn": "EE",
  "Auckland": "NZ", "Wellington": "NZ"
};

const COUNTRY_HINTS = {
  "united kingdom": { country: "GB", city: "United Kingdom" },
  "great britain": { country: "GB", city: "United Kingdom" },
  "england": { country: "GB", city: "United Kingdom" },
  "uk": { country: "GB", city: "United Kingdom" },
  "ireland": { country: "IE", city: "Ireland" },
  "canada": { country: "CA", city: "Canada" },
  "australia": { country: "AU", city: "Australia" },
  "singapore": { country: "SG", city: "Singapore" },
  "germany": { country: "DE", city: "Germany" },
  "netherlands": { country: "NL", city: "Netherlands" },
  "switzerland": { country: "CH", city: "Switzerland" },
  "sweden": { country: "SE", city: "Sweden" },
  "denmark": { country: "DK", city: "Denmark" },
  "norway": { country: "NO", city: "Norway" },
  "spain": { country: "ES", city: "Spain" },
  "portugal": { country: "PT", city: "Portugal" },
  "estonia": { country: "EE", city: "Estonia" },
  "new zealand": { country: "NZ", city: "New Zealand" }
};

const EXCLUDED_TITLE_KEYWORDS = [
  "intern", "internship", "apprentice", "apprenticeship", "graduate program",
  "graduate scheme", "working student", "student worker", "campus ambassador",
  "risk, ethics", "advocacy & legal"
];

const ROLE_FAMILIES = [
  {
    family: "Engineering",
    keywords: [
      "software engineer", "frontend engineer", "front end engineer", "backend engineer",
      "back end engineer", "full stack engineer", "fullstack engineer", "mobile engineer",
      "ios engineer", "android engineer", "platform engineer", "infrastructure engineer",
      "site reliability", "sre", "devops", "developer", "technical lead", "engineering manager",
      "solutions engineer", "sales engineer", "machine learning engineer", "ml engineer"
    ]
  },
  {
    family: "Product",
    keywords: ["product manager", "product owner", "product lead", "product strategy", "group product", "product operations", "product ops"]
  },
  {
    family: "Design",
    keywords: ["product designer", "ux designer", "ui designer", "content designer", "brand designer", "visual designer", "design manager", "user researcher", "ux researcher"]
  },
  {
    family: "Data/Analytics",
    keywords: ["data analyst", "business analyst", "analytics", "data scientist", "data science", "business intelligence", "bi analyst", "data engineer", "analytics engineer", "insights analyst"]
  },
  {
    family: "Security/IT",
    keywords: ["security", "cybersecurity", "information security", "trust and safety", "it support", "systems administrator", "network engineer", "cloud infrastructure", "privacy engineer"]
  },
  {
    family: "Sales",
    keywords: ["account executive", "sales", "business development", "bdr", "sdr", "account manager", "partnerships", "partner manager", "enterprise account", "commercial account", "sales operations", "sales ops", "sales strategy", "sales excellence"]
  },
  {
    family: "Marketing",
    keywords: ["marketing", "growth", "demand generation", "demand gen", "product marketing", "content marketing", "field marketing", "brand marketing", "marketing operations", "marketing ops", "seo", "performance marketing", "lifecycle marketing"]
  },
  {
    family: "Finance",
    keywords: ["fp&a", "fpa", "financial planning", "accounting", "accountant", "controller", "strategic finance", "revenue finance", "deal desk", "corporate finance", "tax", "treasury", "procurement", "payroll", "finance manager", "finance analyst"]
  },
  {
    family: "Operations",
    keywords: ["operations", "revenue operations", "revops", "rev ops", "business operations", "biz ops", "gtm operations", "gtm ops", "go-to-market operations", "field operations", "workplace operations", "salesforce administrator"]
  },
  {
    family: "Customer Success/Support",
    keywords: ["customer success", "customer support", "technical support", "support engineer", "implementation", "onboarding", "solutions consultant", "professional services", "customer experience", "renewals", "support manager"]
  },
  {
    family: "People/HR",
    keywords: ["people", "human resources", "hr business partner", "talent acquisition", "recruiter", "recruiting", "compensation", "benefits", "people operations", "employee experience", "learning and development"]
  },
  {
    family: "Legal/Compliance",
    keywords: ["legal counsel", "senior legal counsel", "commercial counsel", "privacy counsel", "compliance", "regulatory", "risk manager", "legal operations", "contract manager"]
  },
  {
    family: "Strategy/Program",
    keywords: ["strategy", "strategic programs", "program manager", "project manager", "chief of staff", "business planning", "revenue strategy", "strategy and operations", "strategy & operations"]
  }
];

const ROLE_FALLBACK_KEYWORDS = [
  "engineer", "developer", "designer", "analyst", "manager", "lead", "director",
  "specialist", "associate", "consultant", "architect", "administrator"
];

const COMPANY_ALIASES = {
  talkdesk2: "talkdesk",
  boxinc: "box"
};

const HIGH_FIT_COMPANIES = new Set([
  "hubspot", "gongio", "klaviyo", "pleo", "personio",
  "typeform", "factorialhr", "talkdesk", "mollie", "pipedrive",
  "mentimeter", "deel", "kahoot", "notion", "xero", "trustpilot", "miro"
]);

const STRONG_VISA_COMPANIES = new Set([
  "hubspot", "datadog", "cloudflare", "gitlab", "figma", "twilio",
  "databricks", "mongodb", "elastic", "confluent", "deel", "snowflake",
  "xero", "canva", "wise"
]);

const LIKELY_VISA_COMPANIES = new Set([
  "gongio", "klaviyo", "pleo", "celonis", "airtable", "brex", "mercury",
  "vercel", "typeform", "feedzai", "mentimeter", "trustpilot", "asana",
  "remote", "sumologic", "contentful", "n26", "cognite", "linear",
  "mollie", "notion", "ramp", "pipedrive", "talkdesk", "box"
]);

const ECOSYSTEM_COMPANIES = new Set([...HIGH_FIT_COMPANIES, "outsystems"]);
const SCALEUP_COMPANIES = new Set([
  "celonis", "airtable", "gitlab", "figma", "linear", "ramp", "brex",
  "mercury", "vercel", "travelperk", "glovo", "feedzai", "unbabel",
  "klarna", "templafy", "remote", "monday", "contentful", "n26",
  "cognite", "wise", "bolt", "canva", "asana", "shopify"
]);

function matchCountry(locationName) {
  if (!locationName) return null;
  const normalized = locationName.toLowerCase();
  for (const [city, code] of Object.entries(CITY_TO_COUNTRY)) {
    if (normalized.includes(city.toLowerCase())) return { country: code, city };
  }
  for (const [hint, loc] of Object.entries(COUNTRY_HINTS)) {
    if (normalized.includes(hint)) return loc;
  }
  return null;
}

function classifyRoleFamily(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  if (EXCLUDED_TITLE_KEYWORDS.some(k => t.includes(k))) return false;
  for (const group of ROLE_FAMILIES) {
    if (group.keywords.some(k => t.includes(k))) return group.family;
  }
  return ROLE_FALLBACK_KEYWORDS.some(k => t.includes(k)) ? "Other" : null;
}

function classifySeniority(title) {
  if (!title) return "Unknown";
  const t = title.toLowerCase();
  if (/\b(chief|cfo|cto|cio|coo|cmo|cro|ceo|vp|vice president|executive)\b/.test(t)) return "Executive";
  if (/\b(director|head of|global head|regional head)\b/.test(t)) return "Director/Head";
  if (/\b(senior|sr\.?|lead|principal|staff)\b/.test(t)) return "Senior/Lead";
  if (/\b(manager|mgr)\b/.test(t)) return "Manager";
  if (/\b(associate|analyst|specialist|coordinator|administrator|consultant)\b/.test(t)) return "Associate/Analyst";
  return "Unknown";
}

function classifyTier(token) {
  const company = canonicalCompany(token);
  if (ECOSYSTEM_COMPANIES.has(company)) return "Ecosystem";
  if (SCALEUP_COMPANIES.has(company)) return "Scaleup";
  return "BigTech";
}

function classifyVisa(token) {
  const company = canonicalCompany(token);
  if (STRONG_VISA_COMPANIES.has(company)) return "Strong";
  if (LIKELY_VISA_COMPANIES.has(company)) return "Likely";
  return "Unknown";
}

function canonicalCompany(token) {
  return COMPANY_ALIASES[token] || token;
}

function calcScore({ visa, seniority, firstSeen, lastFilled, today }) {
  const visaW = { Strong: 100, Likely: 75, Unknown: 50 };
  const seniorityW = {
    Executive: 95,
    "Director/Head": 90,
    "Senior/Lead": 85,
    Manager: 80,
    "Associate/Analyst": 70,
    Unknown: 65
  };
  const freshness = lastFilled ? 30 : daysBetween(firstSeen, today) <= 7 ? 100 : 80;
  return Math.round((visaW[visa] || 50) * 0.5 + (seniorityW[seniority] || 65) * 0.3 + freshness * 0.2);
}

function normalizePosting(posting, today) {
  const roleFamily = posting.role_family || classifyRoleFamily(posting.title) || "Other";
  const seniority = posting.seniority || classifySeniority(posting.title);
  const visa = posting.visa || "Unknown";
  const firstSeen = posting.first_seen || today;
  const score = calcScore({
    visa,
    seniority,
    firstSeen,
    lastFilled: posting.last_filled,
    today
  });
  return {
    ...posting,
    role_family: roleFamily,
    seniority,
    score
  };
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function sourceId(source) {
  return `${source.source}-${source.token}`;
}

function postingSourceId(posting) {
  return `${posting.source}-${posting.source_token || posting.company}`;
}

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cf: { cacheTtl: 0 } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function fetchGreenhouse(token) {
  const data = await fetchJSON(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`);
  if (!data) return null;
  return (data.jobs || []).map(j => ({
    id: String(j.id),
    title: j.title,
    location: j.location?.name,
    url: j.absolute_url
  }));
}

async function fetchAshby(token) {
  const data = await fetchJSON(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
  if (!data) return null;
  const out = [];
  for (const j of data.jobs || []) {
    if (j.isListed === false) continue;
    const secondary = (j.secondaryLocations || [])
      .map(s => typeof s === "string" ? s : s?.location)
      .filter(Boolean);
    const locs = [j.location, ...secondary].filter(Boolean);
    locs.forEach((loc, i) => out.push({
      id: i === 0 ? String(j.id) : `${j.id}-${i}`,
      title: j.title,
      location: loc,
      url: j.jobUrl
    }));
  }
  return out;
}

async function fetchLever(token) {
  const data = await fetchJSON(`https://api.lever.co/v0/postings/${token}?mode=json`);
  if (!Array.isArray(data)) return null;
  const out = [];
  for (const j of data) {
    const all = j.categories?.allLocations?.length
      ? j.categories.allLocations
      : [j.categories?.location];
    const locs = all.filter(Boolean);
    locs.forEach((loc, i) => out.push({
      id: i === 0 ? String(j.id) : `${j.id}-${i}`,
      title: j.text,
      location: loc,
      url: j.hostedUrl
    }));
  }
  return out;
}

async function fetchSmartRecruiters(token) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 10; page++) {
    const data = await fetchJSON(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100&offset=${offset}`);
    if (!data) return page === 0 ? null : out;
    const content = data.content || [];
    for (const j of content) {
      const loc = j.location?.fullLocation
        || [j.location?.city, j.location?.country].filter(Boolean).join(", ");
      const slug = j.company?.identifier || token;
      out.push({
        id: String(j.id),
        title: j.name,
        location: loc,
        url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`
      });
    }
    offset += content.length;
    if (content.length < 100 || offset >= (data.totalFound || 0)) break;
  }
  return out;
}

export async function runScan(env) {
  const today = todayUTC();
  const prev = (await env.KV.get("state", "json")) || { postings: {} };
  const found = {};
  const failedSources = new Set();
  const okSources = new Set();
  let okCount = 0;
  let failCount = 0;

  const sources = [
    ...GREENHOUSE_TOKENS.map(t => ({ source: "greenhouse", token: t, fetch: fetchGreenhouse })),
    ...ASHBY_TOKENS.map(t => ({ source: "ashby", token: t, fetch: fetchAshby })),
    ...LEVER_TOKENS.map(t => ({ source: "lever", token: t, fetch: fetchLever })),
    ...SMARTRECRUITERS_TOKENS.map(t => ({ source: "smartrecruiters", token: t, fetch: fetchSmartRecruiters }))
  ];

  for (let i = 0; i < sources.length; i += 8) {
    const batch = sources.slice(i, i + 8);
    const results = await Promise.allSettled(batch.map(async s => {
      try {
        return { s, jobs: await s.fetch(s.token) };
      } catch {
        return { s, jobs: null };
      }
    }));

    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value.jobs) {
        failCount++;
        const failed = r.status === "fulfilled" ? r.value.s : null;
        if (failed) failedSources.add(sourceId(failed));
        continue;
      }
      okCount++;
      const { s, jobs } = r.value;
      okSources.add(sourceId(s));
      for (const job of jobs) {
        const loc = matchCountry(job.location);
        if (!loc) continue;
        const roleFamily = classifyRoleFamily(job.title);
        if (!roleFamily) continue;

        const id = `${s.source}-${s.token}-${job.id}`;
        const existed = prev.postings[id];
        const visa = classifyVisa(s.token);
        const firstSeen = existed?.first_seen || today;
        const seniority = classifySeniority(job.title);

        found[id] = {
          id,
          source: s.source,
          source_token: s.token,
          company: canonicalCompany(s.token),
          title: job.title,
          location: job.location,
          city: loc.city,
          country: loc.country,
          url: job.url,
          tier: classifyTier(s.token),
          role_family: roleFamily,
          seniority,
          visa,
          score: calcScore({ visa, seniority, firstSeen, lastFilled: null, today }),
          first_seen: firstSeen,
          last_seen: today,
          last_filled: null
        };
      }
    }
  }

  if (okCount === 0) {
    return { error: "all_fetch_failed", okCount, failCount, failedSources: [...failedSources] };
  }

  const totalBoards = sources.length;
  if (failCount / totalBoards > FAILURE_ABORT_RATIO) {
    return {
      error: "too_many_fetch_failures",
      okCount,
      failCount,
      totalBoards,
      failedSources: [...failedSources]
    };
  }

  const merged = {};
  for (const [id, p] of Object.entries(prev.postings)) {
    if (found[id]) continue;
    if (!ACTIVE_SOURCES.has(p.source)) continue;
    if (failedSources.has(postingSourceId(p))) {
      merged[id] = normalizePosting(p, today);
      continue;
    }
    const filledDate = p.last_filled || today;
    if (daysBetween(filledDate, today) <= 7) {
      merged[id] = normalizePosting({ ...p, last_filled: filledDate }, today);
    }
  }
  Object.assign(merged, found);

  const next = {
    last_scan: today,
    last_scan_at: new Date().toISOString(),
    postings: merged,
    scan_meta: {
      okCount,
      failCount,
      totalBoards,
      okSources: [...okSources],
      failedSources: [...failedSources]
    }
  };

  await env.KV.put("state", JSON.stringify(next));
  await env.KV.put("jobs", JSON.stringify({
    last_scan: next.last_scan,
    last_scan_at: next.last_scan_at,
    scan_meta: next.scan_meta,
    postings: Object.values(merged)
  }));

  return { okCount, failCount, total: Object.keys(merged).length };
}

const ACCOUNT_TYPES = new Set(["individual", "agency"]);
const BRAND_THEMES = new Set(["cobalt", "graphite", "aurora"]);
const JOB_PAGE_SIZE = 15;
const MAX_JOB_PAGE_SIZE = 15;
const PAGE_ACCESS_COOKIE = "job_page_access";
const PAGE_ACCESS_TTL_SECONDS = 30 * 60;
const STATUSES = new Set([
  "Not started",
  "Saved",
  "Applied",
  "Recruiter screen",
  "Interview",
  "Final round",
  "Offer",
  "Rejected",
  "On hold"
]);
const ARCHIVE_STATUSES = new Set(["Rejected", "On hold"]);
const SITE_ORIGIN = "https://livejobindex.com";
const HOME_META_DESCRIPTION = "Find real-time openings at the world's leading tech companies. Filter instantly by location, seniority, and visa-aware hiring signals. Updated daily.";
const COUNTRY_NAMES = {
  GB: "UK",
  IE: "Ireland",
  CA: "Canada",
  AU: "Australia",
  SG: "Singapore",
  DE: "Germany",
  NL: "Netherlands",
  CH: "Switzerland",
  SE: "Sweden",
  DK: "Denmark",
  NO: "Norway",
  ES: "Spain",
  PT: "Portugal",
  EE: "Estonia",
  NZ: "New Zealand"
};
const SEO_PAGES = {
  "/jobs": {
    title: "Explore Live Jobs at Top Global Tech Companies",
    description: "Browse real-time openings at leading tech companies. Filter active roles by market, seniority, role family, and visa-aware hiring signals.",
    heading: "Explore Live Jobs",
    eyebrow: "Live jobs",
    intro: "Browse active roles from public company career feeds, organized by market, company tier, seniority, and role family.",
    cta: "Open Live Jobs",
    appHref: "/",
    schemaType: "CollectionPage"
  },
  "/visa-roles": {
    title: "Visa-Aware Tech Roles with Strong Hiring Signals",
    description: "Find global tech openings at companies with strong visa support signals. Review active roles by location, seniority, and company tier.",
    heading: "Visa-Aware Roles",
    eyebrow: "Sponsorship signals",
    intro: "Focus your search on companies with strong or likely sponsorship history while keeping the current signal heuristic clear.",
    cta: "View Visa-Aware Roles",
    appHref: "/",
    schemaType: "CollectionPage"
  },
  "/pipeline": {
    title: "My Pipeline: Save Targets and Track Applications",
    description: "Save job targets, organize application status, and manage your search pipeline inside Live Job Index.",
    heading: "My Pipeline",
    eyebrow: "Application tracking",
    intro: "Keep saved targets, application status, notes, and account preferences together once you sign in.",
    cta: "Sign In to Track Pipeline",
    appHref: "/profile",
    schemaType: "WebPage"
  },
  "/insights": {
    title: "Market Insights for Global Tech Hiring",
    description: "Track lightweight hiring trends across leading markets, top tech companies, role families, and visa-aware opportunity signals.",
    heading: "Market Insights",
    eyebrow: "Hiring trends",
    intro: "Review lightweight trends from the current job feed, including strongest markets, role families, and visa-aware hiring signals.",
    cta: "Explore Hiring Trends",
    appHref: "/",
    schemaType: "CollectionPage"
  }
};

function jsonResponse(data, init = {}, supabaseContext = null) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  for (const cookie of supabaseContext?.cookieHeaders || []) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function errorResponse(status, message, supabaseContext = null) {
  return jsonResponse({ error: message }, { status }, supabaseContext);
}

function redirectResponse(location, status = 303, supabaseContext = null) {
  const headers = new Headers({ Location: location });
  for (const cookie of supabaseContext?.cookieHeaders || []) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status, headers });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

function clampInteger(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function normalizeJobQuery(payload = {}) {
  const filters = payload.filters && typeof payload.filters === "object" ? payload.filters : {};
  return {
    page: clampInteger(payload.page, 1, 1, 10000),
    per_page: clampInteger(payload.per_page, JOB_PAGE_SIZE, 1, MAX_JOB_PAGE_SIZE),
    sort: ["score", "company", "title", "role", "country", "status"].includes(payload.sort) ? payload.sort : "score",
    dir: payload.dir === "asc" ? "asc" : "desc",
    search: cleanString(payload.search || filters.search).toLowerCase(),
    filters: {
      country: cleanStringArray(filters.country),
      tier: cleanStringArray(filters.tier),
      family: cleanStringArray(filters.family),
      seniority: cleanStringArray(filters.seniority),
      visa: cleanStringArray(filters.visa),
      presets: cleanStringArray(filters.presets)
    },
    ids: cleanStringArray(payload.ids)
  };
}

function postingIsNew(posting) {
  if (posting.last_filled || !posting.first_seen) return false;
  return daysBetween(posting.first_seen, todayUTC()) <= 7;
}

function postingMatchesQuery(posting, query) {
  if (query.ids.length && !query.ids.includes(posting.id)) return false;
  const filters = query.filters;
  if (filters.country.length && !filters.country.includes(posting.country)) return false;
  if (filters.tier.length && !filters.tier.includes(posting.tier)) return false;
  if (filters.family.length && !filters.family.includes(posting.role_family)) return false;
  if (filters.seniority.length && !filters.seniority.includes(posting.seniority)) return false;
  if (filters.visa.length && !filters.visa.includes(posting.visa)) return false;
  if (filters.presets.includes("senior") && !["Senior/Lead", "Manager", "Director/Head", "Executive"].includes(posting.seniority)) return false;
  if (filters.presets.includes("strong-visa") && posting.visa !== "Strong") return false;
  if (filters.presets.includes("new") && !postingIsNew(posting)) return false;
  if (query.search) {
    const blob = [
      posting.company,
      posting.title,
      posting.city,
      posting.location,
      posting.country,
      posting.tier,
      posting.role_family,
      posting.seniority,
      posting.visa
    ].join(" ").toLowerCase();
    if (!blob.includes(query.search)) return false;
  }
  return true;
}

function sortPostings(postings, query) {
  const dir = query.dir === "asc" ? 1 : -1;
  const key = query.sort === "role" ? "title" : query.sort;
  return [...postings].sort((a, b) => {
    let va = key === "status" ? (a.last_filled ? "Filled" : "Not started") : a[key];
    let vb = key === "status" ? (b.last_filled ? "Filled" : "Not started") : b[key];
    if (typeof va === "string") {
      va = va.toLowerCase();
      vb = String(vb || "").toLowerCase();
    }
    if (va == null) va = "";
    if (vb == null) vb = "";
    return va < vb ? -dir : va > vb ? dir : 0;
  });
}

function pagePostings(data, query) {
  const all = Array.isArray(data.postings) ? data.postings : [];
  const matching = sortPostings(all.filter(posting => postingMatchesQuery(posting, query)), query);
  const total = matching.length;
  const totalPages = Math.max(1, Math.ceil(total / query.per_page));
  const page = Math.min(query.page, totalPages);
  const start = (page - 1) * query.per_page;
  return {
    last_scan: data.last_scan || null,
    last_scan_at: data.last_scan_at || null,
    scan_meta: data.scan_meta || null,
    postings: matching.slice(start, start + query.per_page),
    pagination: {
      page,
      per_page: query.per_page,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1
    }
  };
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

async function hmacSignature(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(request, name) {
  const cookies = parseCookieHeader(request.headers.get("Cookie") || "");
  return cookies.find(cookie => cookie.name === name)?.value || "";
}

async function createPageAccessCookie(userId, env) {
  if (!env.PAGE_ACCESS_SECRET) return "";
  const expiresAt = Math.floor(Date.now() / 1000) + PAGE_ACCESS_TTL_SECONDS;
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ sub: userId, exp: expiresAt })));
  const signature = await hmacSignature(env.PAGE_ACCESS_SECRET, payload);
  return serializeCookieHeader(PAGE_ACCESS_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: PAGE_ACCESS_TTL_SECONDS
  });
}

async function hasValidPageAccessCookie(request, userId, env) {
  if (!env.PAGE_ACCESS_SECRET) return false;
  const value = cookieValue(request, PAGE_ACCESS_COOKIE);
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  const expected = await hmacSignature(env.PAGE_ACCESS_SECRET, payload);
  if (!timingSafeEqual(signature, expected)) return false;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    return decoded.sub === userId && Number(decoded.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function isLowBotScore(request) {
  const bot = request.cf?.botManagement;
  if (!bot || bot.verifiedBot) return false;
  const score = Number(bot.score);
  return Number.isFinite(score) && score > 0 && score < 30;
}

async function validateTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET || !token) return false;
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: request.headers.get("CF-Connecting-IP") || undefined
    })
  });
  if (!result.ok) return false;
  const data = await result.json();
  return Boolean(data.success);
}

function appOrigin(env) {
  return env.APP_ORIGIN || "https://livejobindex.com";
}

function safeAuthNext(value) {
  return ["/", "/profile", "/onboarding"].includes(value) ? value : "/";
}

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  return new Request(url.toString(), request);
}

const TRUST_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()"
};

function withTrustHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(TRUST_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function fetchAsset(request, env, pathname) {
  const response = await env.ASSETS.fetch(pathname ? assetRequest(request, pathname) : request);
  return withTrustHeaders(response);
}

async function readJSON(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function hasAuthMaterial(request) {
  return !!request.headers.get("Authorization") || !!request.headers.get("Cookie");
}

function createSupabaseContext(request, env) {
  if (env.SUPABASE_CLIENT) {
    return { supabase: env.SUPABASE_CLIENT, cookieHeaders: [] };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required for account routes");
  }

  const cookieHeaders = [];
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") || "");
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieHeaders.push(serializeCookieHeader(name, value, options));
        }
      }
    }
  });

  return { supabase, cookieHeaders };
}

async function requireUser(request, env) {
  if (!hasAuthMaterial(request) && !env.SUPABASE_CLIENT) {
    return { response: errorResponse(401, "unauthorized") };
  }

  const context = createSupabaseContext(request, env);
  const { data, error } = await context.supabase.auth.getUser();
  if (error || !data?.user) {
    return { context, response: errorResponse(401, "unauthorized", context) };
  }
  return { context, user: data.user };
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value) {
  return Array.isArray(value)
    ? value.map(cleanString).filter(Boolean)
    : [];
}

function buildUserDefaults(user, accountType = "individual") {
  return {
    id: user.id,
    email: user.email || "",
    brand_theme: "graphite",
    account_type: accountType,
    onboarding_completed: false
  };
}

async function ensureAccountRows(supabase, user, accountType = "individual") {
  await supabase
    .from("users")
    .upsert(buildUserDefaults(user, accountType), { onConflict: "id", ignoreDuplicates: true });

  await supabase
    .from("account_access")
    .upsert({
      user_id: user.id,
      account_type: accountType,
      plan: "free",
      api_access_enabled: false,
      integrations_enabled: false,
      export_enabled: accountType === "agency" ? "limited" : "none",
      rate_limit_tier: "free"
    }, { onConflict: "user_id", ignoreDuplicates: true });
}

async function fetchMe(supabase, user) {
  await ensureAccountRows(supabase, user);

  const [
    appUser,
    individualProfile,
    agencyProfile,
    accountAccess
  ] = await Promise.all([
    supabase.from("users").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("agency_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("account_access").select("*").eq("user_id", user.id).maybeSingle()
  ]);

  for (const result of [appUser, individualProfile, agencyProfile, accountAccess]) {
    if (result.error) throw result.error;
  }

  return {
    auth_user: {
      id: user.id,
      email: user.email || null,
      full_name: cleanString(user.user_metadata?.full_name || user.user_metadata?.name) || null
    },
    user: appUser.data,
    individual_profile: individualProfile.data,
    agency_profile: agencyProfile.data,
    account_access: accountAccess.data
  };
}

async function recordActivity(supabase, userId, eventType, entityType = null, entityId = null, metadata = {}) {
  await supabase.from("user_activity").insert({
    user_id: userId,
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId,
    metadata
  });
}

function validateIndividualProfile(payload) {
  const profile = {
    full_name: cleanString(payload.full_name),
    current_title: cleanString(payload.current_title),
    years_experience: Number(payload.years_experience),
    target_role_families: cleanStringArray(payload.target_role_families),
    target_seniority: cleanString(payload.target_seniority),
    target_countries: cleanStringArray(payload.target_countries),
    visa_needed: Boolean(payload.visa_needed),
    preferred_work_mode: cleanString(payload.preferred_work_mode) || null,
    salary_min_usd: payload.salary_min_usd === "" || payload.salary_min_usd == null
      ? null
      : Number(payload.salary_min_usd),
    linkedin_url: cleanString(payload.linkedin_url) || null,
    resume_url: cleanString(payload.resume_url) || null
  };

  if (!profile.full_name) return { error: "full_name is required" };
  if (!profile.current_title) return { error: "current_title is required" };
  if (!Number.isFinite(profile.years_experience) || profile.years_experience < 0) {
    return { error: "years_experience must be a non-negative number" };
  }
  if (!profile.target_role_families.length) return { error: "target_role_families is required" };
  if (!profile.target_seniority) return { error: "target_seniority is required" };
  if (!profile.target_countries.length) return { error: "target_countries is required" };
  if (profile.salary_min_usd != null && (!Number.isFinite(profile.salary_min_usd) || profile.salary_min_usd < 0)) {
    return { error: "salary_min_usd must be a non-negative number" };
  }

  return { profile };
}

function validateAgencyProfile(payload) {
  const profile = {
    agency_name: cleanString(payload.agency_name),
    agency_type: cleanString(payload.agency_type),
    target_markets: cleanStringArray(payload.target_markets),
    target_role_families: cleanStringArray(payload.target_role_families),
    target_countries: cleanStringArray(payload.target_countries),
    use_case: cleanString(payload.use_case),
    integration_interest: cleanString(payload.integration_interest) || "none",
    monthly_data_volume: cleanString(payload.monthly_data_volume) || null
  };

  if (!profile.agency_name) return { error: "agency_name is required" };
  if (!profile.agency_type) return { error: "agency_type is required" };
  if (!profile.use_case) return { error: "use_case is required" };
  if (!profile.target_role_families.length) return { error: "target_role_families is required" };
  if (!profile.target_countries.length) return { error: "target_countries is required" };

  return { profile };
}

async function handleSignup(request, env) {
  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const email = cleanString(payload.email).toLowerCase();
  const password = typeof payload.password === "string" ? payload.password : "";
  const fullName = cleanString(payload.full_name || payload.name);
  if (!email || !password || !fullName) {
    return errorResponse(400, "email, password, and full_name are required");
  }

  const context = createSupabaseContext(request, env);
  const origin = new URL(request.url).origin;
  const { data, error } = await context.supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: origin
    }
  });
  if (error) return errorResponse(400, error.message, context);

  if (data?.user && data?.session) {
    await ensureAccountRows(context.supabase, data.user);
  }

  return jsonResponse({
    confirmation_required: !data?.session,
    user: data?.user ? { id: data.user.id, email: data.user.email } : null
  }, { status: 201 }, context);
}

async function handleLogin(request, env) {
  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const email = cleanString(payload.email).toLowerCase();
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!email || !password) return errorResponse(400, "email and password are required");

  const context = createSupabaseContext(request, env);
  const { data, error } = await context.supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.user) return errorResponse(401, error?.message || "unauthorized", context);

  await ensureAccountRows(context.supabase, data.user);
  await context.supabase
    .from("users")
    .update({ last_login_at: new Date().toISOString(), email: data.user.email || email })
    .eq("id", data.user.id);
  await recordActivity(context.supabase, data.user.id, "login");

  return jsonResponse(await fetchMe(context.supabase, data.user), {}, context);
}

async function handleGoogleLogin(request, env) {
  const requestUrl = new URL(request.url);
  const next = safeAuthNext(requestUrl.searchParams.get("next"));
  const callbackUrl = new URL(`${appOrigin(env)}/auth/callback`);
  if (next !== "/") callbackUrl.searchParams.set("next", next);

  const context = createSupabaseContext(request, env);
  const { data, error } = await context.supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString()
    }
  });

  if (error || !data?.url) {
    return redirectResponse("/?auth_error=google_oauth_unavailable", 303, context);
  }

  return redirectResponse(data.url, 302, context);
}

async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = cleanString(url.searchParams.get("code"));
  const next = safeAuthNext(url.searchParams.get("next"));
  if (!code) {
    return redirectResponse(`${next}?auth_error=missing_code`);
  }

  const context = createSupabaseContext(request, env);
  const { error } = await context.supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectResponse(`${next}?auth_error=oauth_exchange_failed`, 303, context);
  }

  const { data, error: userError } = await context.supabase.auth.getUser();
  if (userError || !data?.user) {
    return redirectResponse(`${next}?auth_error=oauth_user_missing`, 303, context);
  }

  await ensureAccountRows(context.supabase, data.user);
  await context.supabase
    .from("users")
    .update({ last_login_at: new Date().toISOString(), email: data.user.email || "" })
    .eq("id", data.user.id);
  await recordActivity(context.supabase, data.user.id, "login_google");

  return redirectResponse(next, 303, context);
}

async function handleLogout(request, env) {
  const context = createSupabaseContext(request, env);
  await context.supabase.auth.signOut();
  return jsonResponse({ ok: true }, {}, context);
}

async function handleMe(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  return jsonResponse(await fetchMe(auth.context.supabase, auth.user), {}, auth.context);
}

async function handleAccountType(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  const accountType = cleanString(payload?.account_type);
  if (!ACCOUNT_TYPES.has(accountType)) {
    return errorResponse(400, "account_type must be individual or agency", auth.context);
  }

  await ensureAccountRows(auth.context.supabase, auth.user, accountType);
  const { error } = await auth.context.supabase
    .from("users")
    .update({ account_type: accountType, onboarding_completed: false })
    .eq("id", auth.user.id);
  if (error) return errorResponse(500, error.message, auth.context);

  await recordActivity(auth.context.supabase, auth.user.id, "onboarding_account_type", "account", auth.user.id, { account_type: accountType });
  return jsonResponse(await fetchMe(auth.context.supabase, auth.user), {}, auth.context);
}

async function handleIndividualProfile(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json", auth.context);

  const validated = validateIndividualProfile(payload);
  if (validated.error) return errorResponse(400, validated.error, auth.context);

  const { error } = await auth.context.supabase
    .from("user_profiles")
    .upsert({ user_id: auth.user.id, ...validated.profile }, { onConflict: "user_id" });
  if (error) return errorResponse(500, error.message, auth.context);

  await recordActivity(auth.context.supabase, auth.user.id, "onboarding_individual_profile");
  return jsonResponse(await fetchMe(auth.context.supabase, auth.user), {}, auth.context);
}

async function handleAgencyProfile(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json", auth.context);

  const validated = validateAgencyProfile(payload);
  if (validated.error) return errorResponse(400, validated.error, auth.context);

  const { error } = await auth.context.supabase
    .from("agency_profiles")
    .upsert({ user_id: auth.user.id, ...validated.profile }, { onConflict: "user_id" });
  if (error) return errorResponse(500, error.message, auth.context);

  await recordActivity(auth.context.supabase, auth.user.id, "onboarding_agency_profile");
  return jsonResponse(await fetchMe(auth.context.supabase, auth.user), {}, auth.context);
}

async function handleCompleteOnboarding(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const me = await fetchMe(auth.context.supabase, auth.user);
  const accountType = me.user?.account_type;
  if (!ACCOUNT_TYPES.has(accountType)) {
    return errorResponse(400, "account_type is required", auth.context);
  }
  if (accountType === "individual" && !me.individual_profile) {
    return errorResponse(400, "individual profile is required", auth.context);
  }
  if (accountType === "agency" && !me.agency_profile) {
    return errorResponse(400, "agency profile is required", auth.context);
  }

  const { error } = await auth.context.supabase
    .from("users")
    .update({ onboarding_completed: true })
    .eq("id", auth.user.id);
  if (error) return errorResponse(500, error.message, auth.context);

  await recordActivity(auth.context.supabase, auth.user.id, "onboarding_complete", "account", auth.user.id, { account_type: accountType });
  return jsonResponse(await fetchMe(auth.context.supabase, auth.user), {}, auth.context);
}

async function handleSettings(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json", auth.context);

  const brandTheme = cleanString(payload.brand_theme);
  if (!BRAND_THEMES.has(brandTheme)) {
    return errorResponse(400, "brand_theme must be cobalt, graphite, or aurora", auth.context);
  }

  const { error } = await auth.context.supabase
    .from("users")
    .update({ brand_theme: brandTheme })
    .eq("id", auth.user.id);
  if (error) return errorResponse(500, error.message, auth.context);

  await recordActivity(auth.context.supabase, auth.user.id, "settings_updated", "account", auth.user.id, { brand_theme: brandTheme });
  return jsonResponse(await fetchMe(auth.context.supabase, auth.user), {}, auth.context);
}

async function readJobsPayload(env) {
  return (await env.KV.get("jobs", "json")) || {
    last_scan: null,
    last_scan_at: null,
    postings: [],
    scan_meta: null
  };
}

async function readJobsPayloadSafe(env) {
  if (!env.KV) {
    return { last_scan: null, last_scan_at: null, postings: [], scan_meta: null };
  }
  try {
    return await readJobsPayload(env);
  } catch {
    return { last_scan: null, last_scan_at: null, postings: [], scan_meta: null };
  }
}

function countBy(postings, field) {
  const counts = new Map();
  for (const posting of postings) {
    const value = posting?.[field];
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en").format(value);
}

function summarizeJobsPayload(data) {
  const postings = Array.isArray(data.postings) ? data.postings.filter(posting => !posting.last_filled) : [];
  const strongVisa = postings.filter(posting => posting.visa === "Strong").length;
  const likelyVisa = postings.filter(posting => posting.visa === "Likely").length;
  const topMarkets = countBy(postings, "country").slice(0, 3).map(([country, count]) => `${COUNTRY_NAMES[country] || country} (${formatNumber(count)})`);
  const topFamilies = countBy(postings, "role_family").slice(0, 3).map(([family, count]) => `${family} (${formatNumber(count)})`);
  const topCompanies = countBy(postings, "company").slice(0, 3).map(([company, count]) => `${company} (${formatNumber(count)})`);

  return {
    activeTotal: postings.length,
    strongVisa,
    visaAwareTotal: strongVisa + likelyVisa,
    topMarkets,
    topFamilies,
    topCompanies,
    lastScan: data.last_scan || data.last_scan_at || null
  };
}

function statCard(label, value) {
  return `<article class="stat-card"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></article>`;
}

function listItems(items, fallback) {
  const values = items.length ? items : [fallback];
  return values.map(item => `<li>${escapeHTML(item)}</li>`).join("");
}

function renderSeoPage(path, summary) {
  const page = SEO_PAGES[path];
  const url = `${SITE_ORIGIN}${path}`;
  const activeCopy = summary.activeTotal ? `${formatNumber(summary.activeTotal)} active roles` : "Active roles updated daily";
  const visaCopy = summary.visaAwareTotal ? `${formatNumber(summary.visaAwareTotal)} visa-aware roles` : "Visa-aware hiring signals";
  const lastScanCopy = summary.lastScan ? `Last scan: ${summary.lastScan}` : "Updated daily";
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": page.schemaType,
        "@id": `${url}#page`,
        url,
        name: page.heading,
        description: page.description,
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` }
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        url: `${SITE_ORIGIN}/`,
        name: "Live Job Index",
        description: HOME_META_DESCRIPTION
      },
      {
        "@type": "WebApplication",
        "@id": `${SITE_ORIGIN}/#app`,
        name: "Live Job Index",
        url: `${SITE_ORIGIN}/`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: HOME_META_DESCRIPTION
      }
    ]
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(page.title)}</title>
<meta name="description" content="${escapeHTML(page.description)}">
<meta name="robots" content="index,follow">
<meta name="theme-color" content="#0d4dff">
<link rel="canonical" href="${escapeHTML(url)}">
<link rel="icon" href="/assets/logo.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHTML(url)}">
<meta property="og:title" content="${escapeHTML(page.title)}">
<meta property="og:description" content="${escapeHTML(page.description)}">
<meta property="og:image" content="${SITE_ORIGIN}/assets/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHTML(page.title)}">
<meta name="twitter:description" content="${escapeHTML(page.description)}">
<meta name="twitter:image" content="${SITE_ORIGIN}/assets/og-image.png">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
:root { color-scheme: dark; --bg: #071016; --panel: #101923; --card: #151f2b; --text: #f6f8fb; --muted: #9ca8b8; --accent: #7dd3fc; --border: rgba(255,255,255,0.14); }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
.page { max-width: 1120px; margin: 0 auto; padding: 28px 22px 42px; }
.top-nav, .footer-nav { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
.top-nav { justify-content: space-between; margin-bottom: 64px; }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; font-weight: 650; }
.brand img { width: 36px; height: 36px; border-radius: 8px; }
.links { display: flex; flex-wrap: wrap; gap: 14px; }
a { color: var(--accent); }
.links a, .footer-nav a { color: var(--muted); text-decoration: none; }
.links a[aria-current="page"] { color: var(--accent); }
.eyebrow { color: var(--accent); font-size: 13px; font-weight: 650; margin: 0 0 10px; }
h1 { max-width: 760px; font-size: clamp(36px, 7vw, 68px); line-height: 0.98; letter-spacing: 0; margin: 0; }
.intro { max-width: 680px; color: var(--muted); font-size: 18px; margin: 18px 0 28px; }
.cta { display: inline-block; background: var(--accent); color: #071016; text-decoration: none; font-weight: 650; padding: 11px 15px; border-radius: 8px; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 42px 0 28px; }
.stat-card, .panel { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
.stat-card span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.stat-card strong { display: block; font-size: 24px; margin-top: 4px; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.panel h2 { font-size: 16px; margin: 0 0 10px; }
.panel ul { margin: 0; padding-left: 18px; color: var(--muted); }
.note { color: var(--muted); font-size: 13px; margin-top: 20px; }
footer { border-top: 1px solid var(--border); margin-top: 44px; padding-top: 18px; color: var(--muted); }
@media (max-width: 760px) { .top-nav { margin-bottom: 44px; } .stats, .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="page">
<nav class="top-nav" aria-label="Primary">
  <a class="brand" href="/"><img src="/assets/logo.svg" alt="Live Job Index logo" width="36" height="36"><span>Live Job Index</span></a>
  <div class="links">
    <a href="/jobs"${path === "/jobs" ? ' aria-current="page"' : ""}>Live Jobs</a>
    <a href="/visa-roles"${path === "/visa-roles" ? ' aria-current="page"' : ""}>Visa Roles</a>
    <a href="/pipeline"${path === "/pipeline" ? ' aria-current="page"' : ""}>My Pipeline</a>
    <a href="/insights"${path === "/insights" ? ' aria-current="page"' : ""}>Market Insights</a>
  </div>
</nav>
<main>
  <p class="eyebrow">${escapeHTML(page.eyebrow)}</p>
  <h1>${escapeHTML(page.heading)}</h1>
  <p class="intro">${escapeHTML(page.intro)}</p>
  <a class="cta" href="${escapeHTML(page.appHref)}">${escapeHTML(page.cta)}</a>
  <section class="stats" aria-label="Current job index summary">
    ${statCard("Live index", activeCopy)}
    ${statCard("Visa-aware", visaCopy)}
    ${statCard("Freshness", lastScanCopy)}
  </section>
  <section class="grid" aria-label="Hiring signal summaries">
    <article class="panel"><h2>Top Markets</h2><ul>${listItems(summary.topMarkets, "Market data appears after the next successful scan.")}</ul></article>
    <article class="panel"><h2>Role Families</h2><ul>${listItems(summary.topFamilies, "Role-family trends appear after the next successful scan.")}</ul></article>
    <article class="panel"><h2>Company Signals</h2><ul>${listItems(summary.topCompanies, "Company trends appear after the next successful scan.")}</ul></article>
  </section>
  <p class="note">Visa-aware labels reflect company-level sponsorship history and hiring signals. They are prioritization heuristics, not sponsorship guarantees.</p>
</main>
<footer>
  <nav class="footer-nav" aria-label="Footer">
    <a href="/">Home</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
  </nav>
</footer>
</div>
</body>
</html>`;
}

async function handleSeoPage(path, env) {
  const data = await readJobsPayloadSafe(env);
  const html = renderSeoPage(path, summarizeJobsPayload(data));
  return withTrustHeaders(new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "public, max-age=300"
    }
  }));
}

async function handlePublicJobs(env) {
  const data = await readJobsPayload(env);
  const payload = pagePostings(data, normalizeJobQuery({ page: 1, per_page: JOB_PAGE_SIZE }));
  return jsonResponse(payload, {
    headers: {
      "Cache-Control": "public, max-age=300"
    }
  });
}

function handlePublicConfig(env) {
  return jsonResponse({
    turnstile_site_key: env.TURNSTILE_SITE_KEY || ""
  }, {
    headers: {
      "Cache-Control": "public, max-age=300"
    }
  });
}

async function handleJobsQuery(request, env) {
  if (isLowBotScore(request)) return errorResponse(403, "bot_check_failed");

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const query = normalizeJobQuery(payload);
  let auth = null;
  let setPageCookie = null;

  if (query.page > 1) {
    auth = await requireUser(request, env);
    if (auth.response) return auth.response;

    const hasCookie = await hasValidPageAccessCookie(request, auth.user.id, env);
    const turnstileToken = cleanString(payload.turnstile_token || payload["cf-turnstile-response"]);
    if (!hasCookie) {
      const verified = await validateTurnstile(request, env, turnstileToken);
      if (!verified) return errorResponse(403, "human_verification_required", auth.context);
      setPageCookie = await createPageAccessCookie(auth.user.id, env);
    }
  }

  const data = await readJobsPayload(env);
  const response = jsonResponse(pagePostings(data, query), {}, auth?.context || null);
  if (setPageCookie) response.headers.append("Set-Cookie", setPageCookie);
  return response;
}

async function handleGetUserJobs(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const { data, error } = await auth.context.supabase
    .from("user_jobs")
    .select("*, viewed_at")
    .eq("user_id", auth.user.id)
    .order("updated_at", { ascending: false });
  if (error) return errorResponse(500, error.message, auth.context);

  return jsonResponse({ jobs: data || [] }, {}, auth.context);
}

async function handlePutUserJob(request, env, jobId) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json", auth.context);

  const normalizedJobId = cleanString(jobId);
  if (!normalizedJobId) return errorResponse(400, "job_id is required", auth.context);

  const { data: existing, error: existingError } = await auth.context.supabase
    .from("user_jobs")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("job_id", normalizedJobId)
    .maybeSingle();
  if (existingError) return errorResponse(500, existingError.message, auth.context);

  const status = payload.status == null ? existing?.status || "Not started" : cleanString(payload.status);
  if (!STATUSES.has(status)) return errorResponse(400, "invalid status", auth.context);

  const now = new Date().toISOString();
  const prevStatus = existing?.status || "Not started";
  const row = {
    user_id: auth.user.id,
    job_id: normalizedJobId,
    status,
    starred: payload.starred == null ? Boolean(existing?.starred) : Boolean(payload.starred),
    notes: payload.notes == null ? existing?.notes || null : cleanString(payload.notes) || null,
    saved_at: existing?.saved_at || null,
    applied_at: existing?.applied_at || null,
    archived_at: existing?.archived_at || null,
    viewed_at: payload.viewed === true ? (existing?.viewed_at || now) : (existing?.viewed_at || null)
  };

  if ((status === "Saved" || row.starred) && !row.saved_at) row.saved_at = now;
  if (status === "Applied" && !row.applied_at) row.applied_at = now;
  if (ARCHIVE_STATUSES.has(status) && !row.archived_at) row.archived_at = now;

  const { data, error } = await auth.context.supabase
    .from("user_jobs")
    .upsert(row, { onConflict: "user_id,job_id" })
    .select("*")
    .single();
  if (error) return errorResponse(500, error.message, auth.context);

  if (payload.viewed === true && !existing?.viewed_at) {
    await auth.context.supabase.from("user_job_history").insert({
      user_id: auth.user.id,
      job_id: normalizedJobId,
      event_type: "viewed",
      to_status: status
    });
  }

  if (status !== prevStatus) {
    await auth.context.supabase.from("user_job_history").insert({
      user_id: auth.user.id,
      job_id: normalizedJobId,
      event_type: "status_changed",
      from_status: prevStatus,
      to_status: status
    });
  }

  if (payload.starred != null && Boolean(payload.starred) !== Boolean(existing?.starred)) {
    await auth.context.supabase.from("user_job_history").insert({
      user_id: auth.user.id,
      job_id: normalizedJobId,
      event_type: "starred",
      to_status: status
    });
  }

  await recordActivity(auth.context.supabase, auth.user.id, "job_state_updated", "job", normalizedJobId, {
    status,
    starred: row.starred
  });
  return jsonResponse({ job: data }, {}, auth.context);
}

async function handleGetUserJobHistory(request, env, jobId) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const normalizedJobId = cleanString(jobId);
  if (!normalizedJobId) return errorResponse(400, "job_id is required", auth.context);

  const { data, error } = await auth.context.supabase
    .from("user_job_history")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("job_id", normalizedJobId)
    .order("created_at", { ascending: false });
  if (error) return errorResponse(500, error.message, auth.context);

  return jsonResponse({ history: data || [] }, {}, auth.context);
}

async function handleActivity(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json", auth.context);

  const eventType = cleanString(payload.event_type);
  if (!eventType) return errorResponse(400, "event_type is required", auth.context);

  const { error } = await auth.context.supabase.from("user_activity").insert({
    user_id: auth.user.id,
    event_type: eventType,
    entity_type: cleanString(payload.entity_type) || null,
    entity_id: cleanString(payload.entity_id) || null,
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}
  });
  if (error) return errorResponse(500, error.message, auth.context);

  return jsonResponse({ ok: true }, { status: 201 }, auth.context);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    if (url.hostname === "www.livejobindex.com") {
      url.hostname = "livejobindex.com";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/privacy") {
      return fetchAsset(request, env, "/privacy.html");
    }

    if (url.pathname === "/terms") {
      return fetchAsset(request, env, "/terms.html");
    }

    if (SEO_PAGES[url.pathname]) {
      return handleSeoPage(url.pathname, env);
    }

    if (url.pathname === "/api/jobs") {
      return handlePublicJobs(env);
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      return handlePublicConfig(env);
    }

    if (url.pathname === "/api/jobs/query" && request.method === "POST") {
      return handleJobsQuery(request, env);
    }

    if (url.pathname === "/api/signup" && request.method === "POST") {
      return handleSignup(request, env);
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    if (url.pathname === "/api/auth/google" && request.method === "GET") {
      return handleGoogleLogin(request, env);
    }

    if (url.pathname === "/auth/callback" && request.method === "GET") {
      return handleAuthCallback(request, env);
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      return handleLogout(request, env);
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      return handleMe(request, env);
    }

    if (url.pathname === "/api/onboarding/account-type" && request.method === "PATCH") {
      return handleAccountType(request, env);
    }

    if (url.pathname === "/api/onboarding/individual-profile" && request.method === "PATCH") {
      return handleIndividualProfile(request, env);
    }

    if (url.pathname === "/api/onboarding/agency-profile" && request.method === "PATCH") {
      return handleAgencyProfile(request, env);
    }

    if (url.pathname === "/api/onboarding/complete" && request.method === "POST") {
      return handleCompleteOnboarding(request, env);
    }

    if (url.pathname === "/api/settings" && request.method === "PATCH") {
      return handleSettings(request, env);
    }

    if (url.pathname === "/api/user-jobs" && request.method === "GET") {
      return handleGetUserJobs(request, env);
    }

    const userJobMatch = url.pathname.match(/^\/api\/user-jobs\/(.+)$/);
    if (userJobMatch && request.method === "PUT") {
      return handlePutUserJob(request, env, decodeURIComponent(userJobMatch[1]));
    }

    const userJobHistoryMatch = url.pathname.match(/^\/api\/user-jobs\/(.+)\/history$/);
    if (userJobHistoryMatch && request.method === "GET") {
      return handleGetUserJobHistory(request, env, decodeURIComponent(userJobHistoryMatch[1]));
    }

    if (url.pathname === "/api/activity" && request.method === "POST") {
      return handleActivity(request, env);
    }

    if (url.pathname === "/api/scan-now") {
      const auth = request.headers.get("X-Scan-Key");
      if (auth !== env.SCAN_KEY) {
        return new Response("unauthorized", { status: 401 });
      }
      const result = await runScan(env);
      return Response.json(result);
    }

    return fetchAsset(request, env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env));
  }
};
