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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/jobs") {
      const data = (await env.KV.get("jobs", "json")) || {
        last_scan: null,
        last_scan_at: null,
        postings: [],
        scan_meta: null
      };
      return Response.json(data, {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    if (url.pathname === "/api/scan-now") {
      const auth = request.headers.get("X-Scan-Key");
      if (auth !== env.SCAN_KEY) {
        return new Response("unauthorized", { status: 401 });
      }
      const result = await runScan(env);
      return Response.json(result);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env));
  }
};
