import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";

// Cloudflare Worker — Job Tracker
// Serves the static HTML and exposes /api/jobs (KV-backed).
// Cron handler (0 3 * * * UTC = 7 AM Dubai) scans supported ATS APIs daily.
// After each scan, results are persisted to Supabase for trend analysis.

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
const INDUSTRIES = {
  TECH: "tech",
  ENGINEERING: "engineering"
};
const TECH_NICHE = "Software";
const ENGINEERING_NICHES = {
  AEC: "AEC / Infrastructure",
  CONSTRUCTION: "Construction / EPC",
  ARCHITECTURE: "Architecture / Built Environment",
  ENERGY: "Energy / Power / Renewables",
  WATER: "Water / Environment",
  AEROSPACE: "Aerospace / Defense / Space",
  SEMICONDUCTORS: "Semiconductors",
  HARDWARE: "Hardware / Consumer Devices",
  ROBOTICS: "Robotics / Autonomy",
  AUTOMOTIVE: "Automotive / EV",
  INDUSTRIAL: "Industrial Technology"
};
const ACTIVE_SOURCES = new Set([
  "greenhouse",
  "ashby",
  "lever",
  "smartrecruiters",
  "workday",
  "rmk",
  "tribepad",
  "nlx"
]);
const FAILURE_ABORT_RATIO = 0.5;

const ENGINEERING_SOURCES = [
  {
    source: "rmk",
    token: "bechtel-engineering",
    company: "bechtel",
    url: "https://jobs.bechtel.com/go/Engineering/399431",
    industry: INDUSTRIES.ENGINEERING,
    niche: ENGINEERING_NICHES.CONSTRUCTION,
    fetch: fetchRmkCategory
  },
  {
    source: "tribepad",
    token: "burohappold",
    company: "buro happold",
    url: "https://vacancies.burohappold.com/jobs/search",
    industry: INDUSTRIES.ENGINEERING,
    niche: ENGINEERING_NICHES.AEC,
    fetch: fetchTribepad
  },
  {
    source: "nlx",
    token: "aecom",
    company: "aecom",
    url: "https://aecom.jobs",
    industry: INDUSTRIES.ENGINEERING,
    niche: ENGINEERING_NICHES.AEC,
    fetch: fetchNlxJobs
  },
  {
    source: "nlx",
    token: "stantec",
    company: "stantec",
    url: "https://stantec.jobs",
    industry: INDUSTRIES.ENGINEERING,
    niche: ENGINEERING_NICHES.AEC,
    fetch: fetchNlxJobs
  },
  workdaySource({
    token: "intel",
    company: "intel",
    host: "intel.wd1.myworkdayjobs.com",
    tenant: "intel",
    site: "External",
    niche: ENGINEERING_NICHES.SEMICONDUCTORS,
    visa: "Strong"
  }),
  workdaySource({
    token: "boeing",
    company: "boeing",
    host: "boeing.wd1.myworkdayjobs.com",
    tenant: "boeing",
    site: "EXTERNAL_CAREERS",
    niche: ENGINEERING_NICHES.AEROSPACE,
    visa: "Likely"
  }),
  workdaySource({
    token: "airbus",
    company: "airbus",
    host: "ag.wd3.myworkdayjobs.com",
    tenant: "ag",
    site: "Airbus",
    niche: ENGINEERING_NICHES.AEROSPACE,
    visa: "Likely"
  }),
  workdaySource({
    token: "aurecon",
    company: "aurecon",
    host: "aurecongroup.wd3.myworkdayjobs.com",
    tenant: "aurecongroup",
    site: "aurecon",
    niche: ENGINEERING_NICHES.AEC,
    visa: "Likely"
  }),
  workdaySource({
    token: "gevernova",
    company: "ge vernova",
    host: "gevernova.wd5.myworkdayjobs.com",
    tenant: "gevernova",
    site: "Vernova_ExternalSite",
    niche: ENGINEERING_NICHES.ENERGY,
    visa: "Likely"
  }),
  workdaySource({
    token: "gensler",
    company: "gensler",
    host: "gensler.wd1.myworkdayjobs.com",
    tenant: "gensler",
    site: "genslercareers",
    niche: ENGINEERING_NICHES.ARCHITECTURE,
    visa: "Likely"
  }),
  workdaySource({
    token: "samsung-careers",
    company: "samsung",
    host: "sec.wd3.myworkdayjobs.com",
    tenant: "sec",
    site: "Samsung_Careers",
    niche: ENGINEERING_NICHES.HARDWARE,
    visa: "Likely"
  }),
  workdaySource({
    token: "3m",
    company: "3m",
    host: "3m.wd1.myworkdayjobs.com",
    tenant: "3m",
    site: "Search",
    niche: ENGINEERING_NICHES.INDUSTRIAL,
    visa: "Likely"
  }),
  workdaySource({
    token: "rockwellautomation",
    company: "rockwell automation",
    host: "rockwellautomation.wd1.myworkdayjobs.com",
    tenant: "rockwellautomation",
    site: "External_Rockwell_Automation",
    niche: ENGINEERING_NICHES.INDUSTRIAL,
    visa: "Likely"
  }),
  workdaySource({
    token: "bostondynamics",
    company: "boston dynamics",
    host: "bostondynamics.wd1.myworkdayjobs.com",
    tenant: "bostondynamics",
    site: "Boston_Dynamics",
    niche: ENGINEERING_NICHES.ROBOTICS,
    visa: "Likely"
  })
];

const CITY_TO_COUNTRY = {
  "London": "GB", "Manchester": "GB", "Edinburgh": "GB", "Derby": "GB",
  "Dublin": "IE", "Cork": "IE",
  "Toronto": "CA", "Vancouver": "CA", "Montreal": "CA",
  "Sydney": "AU", "Melbourne": "AU", "Brisbane": "AU", "Perth": "AU",
  "San Francisco": "US", "San Jose": "US", "Palo Alto": "US", "Mountain View": "US",
  "Menlo Park": "US", "Bay Area": "US", "New York": "US", "Seattle": "US",
  "Bellevue": "US", "Redmond": "US", "Austin": "US", "Boston": "US",
  "Cambridge": "US", "Denver": "US", "Chicago": "US", "Atlanta": "US",
  "Los Angeles": "US", "San Diego": "US", "Washington, DC": "US",
  "Washington DC": "US", "Raleigh": "US", "Miami": "US", "Detroit": "US",
  "Reston": "US", "Kansas City": "US", "Phoenix": "US", "Santa Clara": "US",
  "Cupertino": "US", "Irvine": "US", "Charlotte": "US", "Milwaukee": "US",
  "Minneapolis": "US", "Orlando": "US", "Nashville": "US", "Honolulu": "US",
  "Remote US": "US",
  "Remote - US": "US", "Remote (US)": "US", "US Remote": "US",
  "United States Remote": "US",
  "Singapore": "SG",
  "Berlin": "DE", "Munich": "DE", "Hamburg": "DE", "Frankfurt": "DE", "Stuttgart": "DE",
  "Amsterdam": "NL", "Rotterdam": "NL", "Eindhoven": "NL",
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
  "united states of america": { country: "US", city: "United States" },
  "united states": { country: "US", city: "United States" },
  "u.s.a": { country: "US", city: "United States" },
  "u.s.": { country: "US", city: "United States" },
  "usa": { country: "US", city: "United States" },
  "us": { country: "US", city: "United States" },
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
      "solutions engineer", "sales engineer", "machine learning engineer", "ml engineer",
      "civil engineer", "structural engineer", "mechanical engineer", "electrical engineer",
      "transport engineer", "transportation engineer", "highway engineer", "rail engineer",
      "water engineer", "environmental engineer", "geotechnical engineer", "fire engineer",
      "facade engineer", "mep engineer", "bim designer", "revit designer", "design engineer",
      "project engineer", "process engineer", "piping engineer", "substation engineer",
      "semiconductor", "hardware engineer", "systems engineer", "aerospace engineer",
      "manufacturing engineer", "robotics engineer", "firmware engineer", "asic", "fpga"
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

const GROWTH_SAAS_COMPANIES = new Set([
  "hubspot", "gongio", "klaviyo", "pleo", "personio",
  "typeform", "factorialhr", "talkdesk", "mollie", "pipedrive",
  "mentimeter", "deel", "kahoot", "notion", "xero", "trustpilot", "miro",
  "outsystems"
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
    if (matchesLocationHint(normalized, hint)) return loc;
  }
  return null;
}

function matchesLocationHint(normalizedLocation, hint) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(hint)}([^a-z0-9]|$)`).test(normalizedLocation);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  if (GROWTH_SAAS_COMPANIES.has(company)) return "GrowthSaaS";
  if (SCALEUP_COMPANIES.has(company)) return "Scaleup";
  return "BigTech";
}

function normalizeTier(tier) {
  if (tier === "Ecosystem") return "GrowthSaaS";
  return tier || "BigTech";
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

function techSource(source, token, fetcher) {
  return {
    source,
    token,
    company: canonicalCompany(token),
    industry: INDUSTRIES.TECH,
    niche: TECH_NICHE,
    fetch: s => fetcher(s.token)
  };
}

function workdaySource({ token, company, host, tenant, site, niche, visa }) {
  return {
    source: "workday",
    token,
    company,
    host,
    tenant,
    site,
    industry: INDUSTRIES.ENGINEERING,
    niche,
    tier: "BigTech",
    visa,
    fetch: fetchWorkday
  };
}

// ------------------------------------------------------------------
// Supabase service-role client (lightweight REST wrapper)
// Used by the scheduled handler to write scan results to the DB.
// ------------------------------------------------------------------

function createServiceClient(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const base = url.replace(/\/$/, "");
  return {
    async insert(table, rows) {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify(rows)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "unknown");
        throw new Error(`Supabase insert error [${table}]: ${res.status} ${text}`);
      }
    },
    async upsert(table, rows, onConflict) {
      const endpoint = new URL(`${base}/rest/v1/${table}`);
      if (onConflict) endpoint.searchParams.set("on_conflict", onConflict);
      const res = await fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(rows)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "unknown");
        throw new Error(`Supabase upsert error [${table}]: ${res.status} ${text}`);
      }
    }
  };
}

async function persistScanToSupabase(env, scanResult, today) {
  const client = createServiceClient(env);
  if (!client) return;

  const postings = Object.values(scanResult.postings);
  if (!postings.length) return;

  // 1. Upsert master job_postings rows
  const jobRows = postings.map(p => ({
    id: p.id,
    source: p.source,
    source_token: p.source_token || p.company,
    company: p.company,
    title: p.title,
    url: p.url,
    industry: p.industry || INDUSTRIES.TECH,
    niche: p.niche || TECH_NICHE,
    first_seen_date: p.first_seen,
    last_seen_date: p.last_seen,
    last_filled_date: p.last_filled || null,
    is_active: !p.last_filled
  }));

  await client.upsert("job_postings", jobRows, "id");

  // 2. Insert snapshot rows for today
  const snapshotRows = postings.map(p => ({
    job_id: p.id,
    scan_date: today,
    title: p.title,
    location: p.location || null,
    city: p.city || null,
    country: p.country,
    industry: p.industry || INDUSTRIES.TECH,
    niche: p.niche || TECH_NICHE,
    role_family: p.role_family,
    seniority: p.seniority,
    visa: p.visa,
    score: p.score,
    tier: p.tier,
    is_new: p.first_seen === today,
    is_filled: Boolean(p.last_filled)
  }));

  await client.upsert("job_snapshots", snapshotRows, "job_id,scan_date");

  // 3. Compute and upsert daily_scan_stats
  const perSource = {};
  const perIndustry = {};
  const perNiche = {};
  const perCountry = {};
  const perFamily = {};
  const perTier = {};
  let newJobs = 0;
  let filledJobs = 0;

  for (const p of postings) {
    perSource[p.source] = (perSource[p.source] || 0) + 1;
    const industry = p.industry || INDUSTRIES.TECH;
    const niche = p.niche || TECH_NICHE;
    perIndustry[industry] = (perIndustry[industry] || 0) + 1;
    perNiche[niche] = (perNiche[niche] || 0) + 1;
    perCountry[p.country] = (perCountry[p.country] || 0) + 1;
    perFamily[p.role_family] = (perFamily[p.role_family] || 0) + 1;
    perTier[p.tier] = (perTier[p.tier] || 0) + 1;
    if (p.first_seen === today) newJobs++;
    if (p.last_filled) filledJobs++;
  }

  await client.upsert("daily_scan_stats", [{
    scan_date: today,
    total_jobs: postings.length,
    new_jobs: newJobs,
    filled_jobs: filledJobs,
    per_source: perSource,
    per_industry: perIndustry,
    per_niche: perNiche,
    per_country: perCountry,
    per_family: perFamily,
    per_tier: perTier,
    ok_count: scanResult.scan_meta?.okCount || 0,
    fail_count: scanResult.scan_meta?.failCount || 0
  }], "scan_date");
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
  const tier = normalizeTier(posting.tier);
  const industry = posting.industry || INDUSTRIES.TECH;
  const niche = posting.niche || (industry === INDUSTRIES.ENGINEERING ? "Engineering" : TECH_NICHE);
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
    tier,
    industry,
    niche,
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

async function fetchJSON(url, init = {}) {
  try {
    const r = await fetch(url, { cf: { cacheTtl: 0 }, ...init });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function fetchText(url) {
  try {
    const r = await fetch(url, { cf: { cacheTtl: 0 } });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function decodeHTML(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeHTML(String(value || "").replace(/<[^>]+>/g, " "));
}

function absoluteUrl(base, href) {
  try {
    return new URL(decodeHTML(href), base).toString();
  } catch {
    return href;
  }
}

function uniqueJobs(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    const id = String(job.id || job.url || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return Boolean(job.title && job.url);
  });
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

async function fetchRmkCategory(source) {
  const html = await fetchText(source.url);
  if (!html) return null;
  const jobs = [];
  const rowPattern = /<a[^>]+href=["']([^"']*\/job\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const url = absoluteUrl(source.url, match[1]);
    const title = stripTags(match[2]);
    const location = inferLocationFromText(`${title} ${url}`) || source.defaultLocation || "";
    jobs.push({ id: url.split("/").filter(Boolean).pop(), title, location, url });
  }
  return uniqueJobs(jobs);
}

async function fetchTribepad(source) {
  const out = [];
  const base = source.url.replace(/\/$/, "");
  for (let page = 1; page <= 5; page++) {
    const url = page === 1 ? base : `${base}/-1/${page}`;
    const html = await fetchText(url);
    if (!html) return page === 1 ? null : out;
    const before = out.length;
    const linkPattern = /<a[^>]+href=["']([^"']*\/jobs\/job\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(linkPattern)) {
      const jobUrl = absoluteUrl(url, match[1]);
      const title = stripTags(match[2]);
      const nearby = html.slice(Math.max(0, match.index - 500), Math.min(html.length, match.index + 1000));
      out.push({
        id: jobUrl.split("/").filter(Boolean).pop(),
        title,
        location: inferLocationFromText(stripTags(nearby)) || source.defaultLocation || "",
        url: jobUrl
      });
    }
    if (out.length === before || !html.includes(`/jobs/search/-1/${page + 1}`)) break;
  }
  return uniqueJobs(out);
}

async function fetchNlxJobs(source) {
  const candidates = [
    `${source.url.replace(/\/$/, "")}/locations/usa/jobs`,
    `${source.url.replace(/\/$/, "")}/jobs`,
    source.url
  ];
  const out = [];
  for (const pageUrl of candidates) {
    const html = await fetchText(pageUrl);
    if (!html) continue;
    const linkPattern = /<a[^>]+href=["']([^"']*(?:\/job\/|\/jobs\/)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(linkPattern)) {
      const url = absoluteUrl(pageUrl, match[1]);
      const title = stripTags(match[2]);
      if (!title || title.length < 4) continue;
      const nearby = html.slice(Math.max(0, match.index - 600), Math.min(html.length, match.index + 1000));
      out.push({
        id: url.split("/").filter(Boolean).pop(),
        title,
        location: inferLocationFromText(stripTags(nearby)) || source.defaultLocation || "",
        url
      });
    }
    if (out.length) break;
  }
  return out.length ? uniqueJobs(out) : null;
}

async function fetchWorkday(source) {
  const data = await fetchJSON(`https://${source.host}/wday/cxs/${source.tenant}/${source.site}/jobs`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      appliedFacets: {},
      limit: 20,
      offset: 0,
      searchText: source.searchText || ""
    })
  });
  if (!data || !Array.isArray(data.jobPostings)) return null;
  return uniqueJobs(data.jobPostings.map(job => {
    const path = job.externalPath || job.externalUrl || "";
    const id = (job.bulletFields || []).find(Boolean) || path.split("/").filter(Boolean).pop();
    const url = /^https?:\/\//i.test(path)
      ? path
      : `https://${source.host}/${source.site}${path.startsWith("/") ? path : `/${path}`}`;
    return {
      id,
      title: job.title,
      location: job.locationsText,
      url
    };
  }));
}

function inferLocationFromText(text) {
  const clean = decodeHTML(text);
  const loc = matchCountry(clean);
  if (!loc) return "";
  return loc.city;
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
    ...GREENHOUSE_TOKENS.map(t => techSource("greenhouse", t, fetchGreenhouse)),
    ...ASHBY_TOKENS.map(t => techSource("ashby", t, fetchAshby)),
    ...LEVER_TOKENS.map(t => techSource("lever", t, fetchLever)),
    ...SMARTRECRUITERS_TOKENS.map(t => techSource("smartrecruiters", t, fetchSmartRecruiters)),
    ...ENGINEERING_SOURCES
  ];

  for (let i = 0; i < sources.length; i += 8) {
    const batch = sources.slice(i, i + 8);
    const results = await Promise.allSettled(batch.map(async s => {
      try {
        return { s, jobs: await s.fetch(s) };
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
        const visa = s.visa || classifyVisa(s.token);
        const firstSeen = existed?.first_seen || today;
        const seniority = classifySeniority(job.title);
        const industry = s.industry || INDUSTRIES.TECH;
        const niche = s.niche || TECH_NICHE;

        found[id] = {
          id,
          source: s.source,
          source_token: s.token,
          company: s.company || canonicalCompany(s.token),
          title: job.title,
          location: job.location,
          city: loc.city,
          country: loc.country,
          url: job.url,
          tier: s.tier || classifyTier(s.token),
          industry,
          niche,
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

  return { okCount, failCount, total: Object.keys(merged).length, next };
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
  US: "United States",
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

const ANON_SESSION_COOKIE = "lji_session";
const ANON_SESSION_TTL_DAYS = 365;
const TRACKABLE_EVENTS = new Set(["job_view", "search", "page_view"]);
const MAX_JSON_BODY_BYTES = 32 * 1024;
const SAFE_SERVER_ERRORS = new Set(["account_setup_failed", "analytics unavailable"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://www.googletagmanager.com https://www.google-analytics.com https://www.clarity.ms https://challenges.cloudflare.com",
  "connect-src 'self' https://*.supabase.co https://cdn.jsdelivr.net https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.clarity.ms https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'"
].join("; ");

function applySupabaseHeaders(headers, supabaseContext) {
  for (const [key, value] of supabaseContext?.responseHeaders || []) {
    headers.set(key, value);
  }
  for (const cookie of supabaseContext?.cookieHeaders || []) {
    headers.append("Set-Cookie", cookie);
  }
}

function jsonResponse(data, init = {}, supabaseContext = null) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  applySupabaseHeaders(headers, supabaseContext);
  return withTrustHeaders(new Response(JSON.stringify(data), { ...init, headers }));
}

function errorResponse(status, message, supabaseContext = null) {
  const safeMessage = status >= 500 && !SAFE_SERVER_ERRORS.has(message) ? "internal_error" : message;
  return jsonResponse({ error: safeMessage }, { status }, supabaseContext);
}

function redirectResponse(location, status = 303, supabaseContext = null) {
  const headers = new Headers({ Location: location });
  applySupabaseHeaders(headers, supabaseContext);
  return withTrustHeaders(new Response(null, { status, headers }));
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
  const industryFilters = cleanStringArray(filters.industry || (payload.industry ? [payload.industry] : []), 5, 40)
    .filter(industry => Object.values(INDUSTRIES).includes(industry));
  return {
    page: clampInteger(payload.page, 1, 1, 10000),
    per_page: clampInteger(payload.per_page, JOB_PAGE_SIZE, 1, MAX_JOB_PAGE_SIZE),
    sort: ["score", "company", "title", "role", "country", "status", "first_seen"].includes(payload.sort) ? payload.sort : "score",
    dir: payload.dir === "asc" ? "asc" : "desc",
    search: cleanString(payload.search || filters.search).toLowerCase(),
    filters: {
      industry: industryFilters,
      niche: cleanStringArray(filters.niche),
      country: cleanStringArray(filters.country),
      tier: cleanStringArray(filters.tier).map(normalizeTier),
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
  const industry = posting.industry || INDUSTRIES.TECH;
  const niche = posting.niche || (industry === INDUSTRIES.ENGINEERING ? "Engineering" : TECH_NICHE);
  if (filters.industry.length && !filters.industry.includes(industry)) return false;
  if (filters.niche.length && !filters.niche.includes(niche)) return false;
  if (filters.country.length && !filters.country.includes(posting.country)) return false;
  const tier = normalizeTier(posting.tier);
  if (filters.tier.length && !filters.tier.includes(tier)) return false;
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
      industry,
      niche,
      tier,
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
    if (va !== vb) return va < vb ? -dir : va > vb ? dir : 0;
    const ca = (a.company || "").toLowerCase();
    const cb = (b.company || "").toLowerCase();
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

function pagePostings(data, query) {
  const all = Array.isArray(data.postings)
    ? data.postings.map(p => ({
      ...p,
      tier: normalizeTier(p.tier),
      industry: p.industry || INDUSTRIES.TECH,
      niche: p.niche || ((p.industry || INDUSTRIES.TECH) === INDUSTRIES.ENGINEERING ? "Engineering" : TECH_NICHE)
    }))
    : [];
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

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return base64UrlEncode(new Uint8Array(digest));
}

async function timingSafeSecretEqual(candidate, expected) {
  if (!candidate || !expected) return false;
  const [candidateHash, expectedHash] = await Promise.all([
    sha256Base64Url(candidate),
    sha256Base64Url(expected)
  ]);
  return timingSafeEqual(candidateHash, expectedHash);
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
  if (!data.success) return false;
  const expectedHostname = new URL(env.APP_ORIGIN || SITE_ORIGIN).hostname;
  if (data.hostname && data.hostname !== expectedHostname) return false;
  if (data.action && data.action !== "jobs_page_access") return false;
  return true;
}

function allowedOrigins(request, env) {
  const requestUrl = new URL(request.url);
  return new Set([
    requestUrl.origin,
    SITE_ORIGIN,
    env.APP_ORIGIN || "",
    "https://www.livejobindex.com"
  ].filter(Boolean));
}

function hasValidOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return allowedOrigins(request, env).has(origin);
}

function requireSameOrigin(request, env) {
  return hasValidOrigin(request, env) ? null : errorResponse(403, "invalid_origin");
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
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Content-Security-Policy": CSP_DIRECTIVES
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
    const length = Number(request.headers.get("Content-Length") || "0");
    if (Number.isFinite(length) && length > MAX_JSON_BODY_BYTES) return null;
    const text = await request.text();
    if (text.length > MAX_JSON_BODY_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hasAuthMaterial(request) {
  return !!request.headers.get("Authorization") || !!request.headers.get("Cookie");
}

function createSupabaseContext(request, env) {
  if (env.SUPABASE_CLIENT) {
    return { supabase: env.SUPABASE_CLIENT, cookieHeaders: [], responseHeaders: new Headers() };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required for account routes");
  }

  const cookieHeaders = [];
  const responseHeaders = new Headers({ "Cache-Control": "private, no-store" });
  const authorization = request.headers.get("Authorization");
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    global: authorization ? { headers: { Authorization: authorization } } : undefined,
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") || "");
      },
      setAll(cookiesToSet, cacheHeaders = {}) {
        for (const { name, value, options } of cookiesToSet) {
          cookieHeaders.push(serializeCookieHeader(name, value, options));
        }
        for (const [key, value] of Object.entries(cacheHeaders)) {
          responseHeaders.set(key, value);
        }
      }
    }
  });

  return { supabase, cookieHeaders, responseHeaders };
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

function cleanString(value, maxLength = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanStringArray(value, maxItems = 50, maxItemLength = 100) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map(item => cleanString(item, maxItemLength)).filter(Boolean)
    : [];
}

function metadataObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(0, 25).map(([key, entryValue]) => {
    const cleanKey = cleanString(key, 80);
    if (!cleanKey) return null;
    if (entryValue == null || typeof entryValue === "boolean" || typeof entryValue === "number") {
      return [cleanKey, entryValue];
    }
    if (typeof entryValue === "string") return [cleanKey, cleanString(entryValue, 500)];
    return [cleanKey, cleanString(JSON.stringify(entryValue), 1000)];
  }).filter(Boolean);
  return Object.fromEntries(entries);
}

function analyticsAllowedEmails(env) {
  return new Set(String(env.ANALYTICS_ALLOWED_EMAILS || "")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean));
}

function requireAnalyticsOwner(auth, env) {
  const allowed = analyticsAllowedEmails(env);
  const email = cleanString(auth.user?.email, 320).toLowerCase();
  return allowed.size > 0 && email && allowed.has(email) ? null : errorResponse(403, "forbidden", auth.context);
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
  const userResult = await supabase
    .from("users")
    .upsert(buildUserDefaults(user, accountType), { onConflict: "id", ignoreDuplicates: true });
  if (userResult.error) throw userResult.error;

  const accessResult = await supabase
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
  if (accessResult.error) throw accessResult.error;
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
    full_name: cleanString(payload.full_name, 160),
    current_title: cleanString(payload.current_title, 160),
    years_experience: Number(payload.years_experience),
    target_role_families: cleanStringArray(payload.target_role_families, 20, 80),
    target_seniority: cleanString(payload.target_seniority, 80),
    target_countries: cleanStringArray(payload.target_countries, 30, 8),
    visa_needed: Boolean(payload.visa_needed),
    preferred_work_mode: cleanString(payload.preferred_work_mode, 80) || null,
    salary_min_usd: payload.salary_min_usd === "" || payload.salary_min_usd == null
      ? null
      : Number(payload.salary_min_usd),
    linkedin_url: cleanString(payload.linkedin_url, 500) || null,
    resume_url: cleanString(payload.resume_url, 500) || null
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
    agency_name: cleanString(payload.agency_name, 180),
    agency_type: cleanString(payload.agency_type, 80),
    target_markets: cleanStringArray(payload.target_markets, 30, 120),
    target_role_families: cleanStringArray(payload.target_role_families, 20, 80),
    target_countries: cleanStringArray(payload.target_countries, 30, 8),
    use_case: cleanString(payload.use_case, 80),
    integration_interest: cleanString(payload.integration_interest, 80) || "none",
    monthly_data_volume: cleanString(payload.monthly_data_volume, 80) || null
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

  const email = cleanString(payload.email, 320).toLowerCase();
  const password = typeof payload.password === "string" ? payload.password : "";
  const fullName = cleanString(payload.full_name || payload.name, 160);
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

  const email = cleanString(payload.email, 320).toLowerCase();
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
  return redirectResponse("/?auth_error=google_frontend_required", 303);
}

async function handleAuthCallback(request, env) {
  return fetchAsset(request, env);
}

async function handleAuthSession(request, env) {
  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const accessToken = cleanString(payload.access_token, 4096);
  const refreshToken = cleanString(payload.refresh_token, 4096);
  if (!accessToken || !refreshToken) {
    return errorResponse(400, "access_token and refresh_token are required");
  }

  const context = createSupabaseContext(request, env);
  const { error: sessionError } = await context.supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  if (sessionError) return errorResponse(401, "invalid_session", context);

  const { data, error: userError } = await context.supabase.auth.getUser();
  if (userError || !data?.user) return errorResponse(401, "invalid_session", context);

  try {
    await ensureAccountRows(context.supabase, data.user);
    await context.supabase
      .from("users")
      .update({ last_login_at: new Date().toISOString(), email: data.user.email || "" })
      .eq("id", data.user.id);
    await recordActivity(context.supabase, data.user.id, "login_google");
    return jsonResponse(await fetchMe(context.supabase, data.user), {}, context);
  } catch {
    return errorResponse(500, "account_setup_failed", context);
  }
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

async function handleAgencyFeedback(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json", auth.context);

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) return errorResponse(400, "message is required", auth.context);
  if (message.length > 2000) return errorResponse(400, "message must be 2000 characters or fewer", auth.context);

  const me = await fetchMe(auth.context.supabase, auth.user);
  if (me.user?.account_type !== "agency" || !me.user?.onboarding_completed || !me.agency_profile) {
    return errorResponse(403, "agency onboarding is required", auth.context);
  }

  const metadata = {
    agency_type: me.agency_profile.agency_type || null,
    use_case: me.agency_profile.use_case || null,
    integration_interest: me.agency_profile.integration_interest || null,
    monthly_data_volume: me.agency_profile.monthly_data_volume || null
  };

  const { error } = await auth.context.supabase.from("agency_feedback").insert({
    user_id: auth.user.id,
    agency_name: me.agency_profile.agency_name || null,
    message,
    metadata
  });
  if (error) return errorResponse(500, error.message, auth.context);

  await recordActivity(auth.context.supabase, auth.user.id, "agency_feedback_submitted", "agency_feedback", auth.user.id, metadata);
  return jsonResponse({ ok: true }, { status: 201 }, auth.context);
}

async function readJobsPayload(env) {
  const payload = (await env.KV.get("jobs", "json")) || {
    last_scan: null,
    last_scan_at: null,
    postings: [],
    scan_meta: null
  };
  return {
    ...payload,
    postings: Array.isArray(payload.postings)
      ? payload.postings.map(p => ({ ...p, tier: normalizeTier(p.tier) }))
      : []
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
.top-nav, .footer-nav, .footer-contact { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; }
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
.footer-contact { margin-bottom: 10px; }
.footer-contact strong { color: var(--text); }
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
  <div class="footer-contact">
    <strong>Contact</strong>
    <span>Business inquiries: <a href="mailto:business@livejobindex.com">business@livejobindex.com</a></span>
    <span>General inquiries: <a href="mailto:hello@livejobindex.com">hello@livejobindex.com</a></span>
  </div>
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

async function handlePublicJobs(request, env) {
  const url = new URL(request.url);
  const requestedIndustry = url.searchParams.get("industry") || INDUSTRIES.TECH;
  const industry = Object.values(INDUSTRIES).includes(requestedIndustry) ? requestedIndustry : INDUSTRIES.TECH;
  const data = await readJobsPayload(env);
  const payload = pagePostings(data, normalizeJobQuery({
    page: 1,
    per_page: JOB_PAGE_SIZE,
    sort: "first_seen",
    dir: "desc",
    industry
  }));
  return jsonResponse(payload, {
    headers: {
      "Cache-Control": "public, max-age=300"
    }
  });
}

function handlePublicConfig(env) {
  return jsonResponse({
    turnstile_site_key: env.TURNSTILE_SITE_KEY || "",
    supabase_url: env.SUPABASE_URL || "",
    supabase_publishable_key: env.SUPABASE_PUBLISHABLE_KEY || ""
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

  const normalizedJobId = cleanString(jobId, 300);
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
    notes: payload.notes == null ? existing?.notes || null : cleanString(payload.notes, 2000) || null,
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

  const normalizedJobId = cleanString(jobId, 300);
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

  const eventType = cleanString(payload.event_type, 120);
  if (!eventType) return errorResponse(400, "event_type is required", auth.context);

  const { error } = await auth.context.supabase.from("user_activity").insert({
    user_id: auth.user.id,
    event_type: eventType,
    entity_type: cleanString(payload.entity_type, 120) || null,
    entity_id: cleanString(payload.entity_id, 300) || null,
    metadata: metadataObject(payload.metadata)
  });
  if (error) return errorResponse(500, error.message, auth.context);

  return jsonResponse({ ok: true }, { status: 201 }, auth.context);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.protocol === "http:") {
      url.protocol = "https:";
      return withTrustHeaders(Response.redirect(url.toString(), 301));
    }

    if (url.hostname === "www.livejobindex.com") {
      url.hostname = "livejobindex.com";
      return withTrustHeaders(Response.redirect(url.toString(), 301));
    }

    if (url.pathname.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
      const originError = requireSameOrigin(request, env);
      if (originError) return originError;
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
      return handlePublicJobs(request, env);
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

    if (url.pathname === "/api/auth/session" && request.method === "POST") {
      return handleAuthSession(request, env);
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

    if (url.pathname === "/api/agency-feedback" && request.method === "POST") {
      return handleAgencyFeedback(request, env);
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

    if (url.pathname === "/api/session" && request.method === "POST") {
      return handleSession(request, env);
    }

    if (url.pathname === "/api/track" && request.method === "POST") {
      return handleTrack(request, env);
    }

    if (url.pathname === "/api/analytics/jobs" && request.method === "GET") {
      return handleAnalyticsJobs(request, env);
    }

    if (url.pathname === "/api/analytics/searches" && request.method === "GET") {
      return handleAnalyticsSearches(request, env);
    }

    if (url.pathname === "/api/analytics/views" && request.method === "GET") {
      return handleAnalyticsViews(request, env);
    }

    if (url.pathname === "/api/scan-now") {
      const auth = request.headers.get("X-Scan-Key");
      if (!await timingSafeSecretEqual(auth, env.SCAN_KEY)) {
        return errorResponse(401, "unauthorized");
      }
      const result = await runScan(env);
      if (result.next && ctx?.waitUntil) {
        ctx.waitUntil(persistScanToSupabase(env, result.next, result.next.last_scan));
      }
      return jsonResponse({ okCount: result.okCount, failCount: result.failCount, total: result.total });
    }

    return fetchAsset(request, env);
  },

  async scheduled(event, env, ctx) {
    const today = todayUTC();
    const scanPromise = runScan(env).then(result => {
      if (result.next) {
        return persistScanToSupabase(env, result.next, today);
      }
    });
    if (ctx?.waitUntil) {
      ctx.waitUntil(scanPromise);
    } else {
      await scanPromise;
    }
  }
};

// ------------------------------------------------------------------
// Session & tracking handlers
// ------------------------------------------------------------------

function getAnonSessionCookie(request) {
  const cookies = parseCookieHeader(request.headers.get("Cookie") || "");
  return cookies.find(c => c.name === ANON_SESSION_COOKIE)?.value || "";
}

async function handleSession(request, env) {
  const existing = getAnonSessionCookie(request);
  if (existing) {
    return jsonResponse({ session_token: existing });
  }
  const token = crypto.randomUUID();
  const cookie = serializeCookieHeader(ANON_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ANON_SESSION_TTL_DAYS * 24 * 60 * 60
  });

  // Persist to Supabase asynchronously if service role key is available
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const client = createServiceClient(env);
    if (client) {
      client.insert("anonymous_sessions", [{
        session_token: token,
        ip_hash: null,
        user_agent_fingerprint: null
      }]).catch(() => {});
    }
  }

  return jsonResponse({ session_token: token }, {
    headers: { "Set-Cookie": cookie }
  });
}

async function handleTrack(request, env) {
  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const eventType = cleanString(payload.type, 80);
  if (!TRACKABLE_EVENTS.has(eventType)) {
    return errorResponse(400, "invalid event type");
  }

  const sessionToken = getAnonSessionCookie(request);
  const hasAuth = hasAuthMaterial(request);

  // Try to resolve user_id for authenticated requests
  let userId = null;
  if (hasAuth && env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) {
    try {
      const context = createSupabaseContext(request, env);
      const { data } = await context.supabase.auth.getUser();
      if (data?.user) userId = data.user.id;
    } catch {
      // ignore auth errors, track as anonymous
    }
  }

  // Resolve session_id from token
  let sessionId = null;
  if (sessionToken && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const client = createServiceClient(env);
      if (client) {
        // We can't easily query via REST POST, so we'll just use the token as-is
        // and let the frontend include session_id if it has it.
        // For now, we track by session_token in metadata.
      }
    } catch {
      // ignore
    }
  }

  // Build insert row based on event type
  const client = createServiceClient(env);
  if (!client) return jsonResponse({ ok: true });

  const baseRow = {
    user_id: userId,
    session_id: cleanString(payload.session_id, 120) || null
  };

  try {
    if (eventType === "job_view") {
      await client.insert("job_views", [{
        ...baseRow,
        job_id: cleanString(payload.job_id, 300) || "",
        source: cleanString(payload.source, 80) || "direct"
      }]);
    } else if (eventType === "search") {
      await client.insert("search_queries", [{
        ...baseRow,
        query_text: cleanString(payload.query_text, 500) || null,
        filters: metadataObject(payload.filters),
        result_count: Number.isFinite(payload.result_count) ? payload.result_count : null
      }]);
    } else if (eventType === "page_view") {
      await client.insert("page_views", [{
        ...baseRow,
        page_path: cleanString(payload.page_path, 300) || "/",
        referrer: cleanString(payload.referrer, 500) || null
      }]);
    }
  } catch {
    // Silently ignore tracking errors so they never break the UX
  }

  return jsonResponse({ ok: true });
}

// ------------------------------------------------------------------
// Analytics API handlers (authenticated)
// ------------------------------------------------------------------

async function handleAnalyticsJobs(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const ownerError = requireAnalyticsOwner(auth, env);
  if (ownerError) return ownerError;

  const client = createServiceClient(env);
  if (!client) return errorResponse(503, "analytics unavailable");

  const url = new URL(request.url);
  const days = clampInteger(url.searchParams.get("days"), 30, 1, 365);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/daily_scan_stats?scan_date=gte.${since}&order=scan_date.desc`, {
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    return jsonResponse({ stats: data || [] }, {}, auth.context);
  } catch (err) {
    return errorResponse(500, "internal_error", auth.context);
  }
}

async function handleAnalyticsSearches(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const ownerError = requireAnalyticsOwner(auth, env);
  if (ownerError) return ownerError;

  const url = new URL(request.url);
  const days = clampInteger(url.searchParams.get("days"), 7, 1, 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/search_queries?created_at=gte.${encodeURIComponent(since)}&order=created_at.desc`, {
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    return jsonResponse({ searches: data || [] }, {}, auth.context);
  } catch (err) {
    return errorResponse(500, "internal_error", auth.context);
  }
}

async function handleAnalyticsViews(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const ownerError = requireAnalyticsOwner(auth, env);
  if (ownerError) return ownerError;

  const url = new URL(request.url);
  const days = clampInteger(url.searchParams.get("days"), 7, 1, 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/job_views?viewed_at=gte.${encodeURIComponent(since)}&order=viewed_at.desc`, {
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    return jsonResponse({ views: data || [] }, {}, auth.context);
  } catch (err) {
    return errorResponse(500, "internal_error", auth.context);
  }
}
