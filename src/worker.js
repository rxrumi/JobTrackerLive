import { createClerkClient, verifyToken } from "@clerk/backend";

// Cloudflare Worker — Job Tracker
// Serves the static HTML and exposes /api/jobs (KV-backed).
// Cron handler (0 3 * * * UTC = 7 AM Dubai) scans supported ATS APIs daily.
// After each scan, results are persisted to D1 for trend analysis.

const GREENHOUSE_TOKENS = [
  "gongio", "klaviyo", "datadog", "cloudflare", "hubspot",
  "pleo", "celonis", "airtable", "gitlab", "figma",
  "brex", "mercury", "vercel", "typeform", "feedzai",
  "mentimeter", "trustpilot", "twilio", "asana",
  "databricks", "mongodb", "elastic", "remote",
  "sumologic", "contentful", "n26", "cognite",
  "talkdesk2", "boxinc", "anthropic", "stripe",
  "pinterest", "linkedin"
];

const ASHBY_TOKENS = [
  "confluent", "deel", "linear", "mollie",
  "notion", "ramp", "snowflake", "xero",
  "openai", "cursor", "perplexity"
];

const LEVER_TOKENS = ["pipedrive"];

const SMARTRECRUITERS_TOKENS = ["canva", "wise"];
const INDUSTRIES = {
  TECH: "tech",
  ENGINEERING: "engineering"
};
const TECH_NICHE = "Software";
const FRONTIER_AI_NICHE = "AI / Frontier";
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
  "yc",
  "workday",
  "rmk",
  "tribepad",
  "nlx",
  "amazon",
  "apple",
  "eightfold"
]);
const FAILURE_ABORT_RATIO = 0.5;
const FETCH_TIMEOUT_MS = 12000;
const STALE_SCAN_LOCK_KEY = "scan:stale-refresh-lock";
const STALE_SCAN_LOCK_TTL_SECONDS = 20 * 60;
const MAX_POSTINGS_PER_SOURCE = 100;
const CUSTOM_SOURCE_LIMIT = 120;
const AMAZON_SEARCH_LOCATIONS = [
  "United States", "United Kingdom", "Ireland", "Canada", "Australia", "Singapore",
  "Germany", "Netherlands", "Switzerland", "Sweden", "Denmark", "Norway", "Spain",
  "Portugal", "Estonia", "New Zealand", "France", "Italy", "Poland", "Belgium",
  "Finland", "Austria", "Japan", "South Korea", "India", "Taiwan"
];
const APPLE_SEARCH_PATHS = [
  "/en-us/search?sort=newest",
  "/en-gb/search?sort=newest",
  "/en-ie/search?sort=newest",
  "/en-ca/search?sort=newest",
  "/en-au/search?sort=newest",
  "/en-sg/search?sort=newest",
  "/de-de/search?sort=newest",
  "/fr-fr/search?sort=newest",
  "/it-it/search?sort=newest",
  "/nl-nl/search?sort=newest",
  "/ja-jp/search?sort=newest",
  "/ko-kr/search?sort=newest",
  "/en-in/search?sort=newest"
];
const YC_BASE_URL = "https://www.ycombinator.com";
const YC_COMPANIES_URL = "https://yc-oss.github.io/api/companies/hiring.json";
const YC_SEED_PATHS = [
  "/jobs",
  "/jobs/role/software-engineer",
  "/jobs/role/product-manager",
  "/jobs/role/operations",
  "/jobs/role/sales-manager",
  "/jobs/role/marketing",
  "/jobs/role/support",
  "/jobs/role/recruiting-hr",
  "/jobs/role/designer",
  "/jobs/role/software-engineer/remote",
  "/jobs/role/product-manager/remote",
  "/jobs/role/operations/remote",
  "/jobs/role/sales-manager/remote",
  "/jobs/role/marketing/remote",
  "/jobs/location/san-francisco",
  "/jobs/role/software-engineer/san-francisco",
  "/jobs/role/product-manager/san-francisco",
  "/jobs/role/operations/san-francisco"
];

// Engineering sources were live-scraped from corporate Workday tenants
// (Intel, Boeing, Airbus, Aurecon, GE Vernova, Gensler, Samsung, 3M,
// Rockwell Automation, Boston Dynamics), Greenhouse (SpaceX), RMK (Bechtel),
// Tribepad (Buro Happold), and NLX (AECOM, Stantec). All of these ATS
// endpoints block or bot-challenge Cloudflare Worker egress IPs, so every
// engineering scan returned null and the postings eventually fell out of
// the 7-day last_filled window. These companies are now curated as static
// engineering targets in ENGINEERING_STATIC_COMPANIES in public/index.html.
const ENGINEERING_SOURCES = [];

const YC_SOURCES = [{
  source: "yc",
  token: "yc-waas",
  company: "Y Combinator",
  industry: INDUSTRIES.TECH,
  niche: TECH_NICHE,
  tier: "Scaleup",
  fetch: fetchYcStartupJobs
}];

const POPULAR_TECH_SOURCES = [
  customTechSource({
    source: "amazon",
    token: "amazon",
    company: "amazon",
    tier: "BigTech",
    visa: "Strong",
    fetch: fetchAmazonJobs
  }),
  customTechSource({
    source: "apple",
    token: "apple",
    company: "apple",
    tier: "BigTech",
    visa: "Strong",
    niche: ENGINEERING_NICHES.HARDWARE,
    fetch: fetchAppleJobs
  }),
  customTechSource({
    source: "eightfold",
    token: "netflix",
    company: "netflix",
    tier: "BigTech",
    visa: "Likely",
    fetch: fetchNetflixJobs
  })
];

const CITY_TO_COUNTRY = {
  "London": "GB", "Manchester": "GB", "Edinburgh": "GB", "Derby": "GB",
  "Dublin": "IE", "Cork": "IE",
  "Toronto": "CA", "Vancouver": "CA", "Montreal": "CA",
  "Sydney": "AU", "Melbourne": "AU", "Brisbane": "AU", "Perth": "AU",
  "San Francisco": "US", "San Jose": "US", "Palo Alto": "US", "Mountain View": "US",
  "Menlo Park": "US", "Bay Area": "US", "New York": "US", "Seattle": "US",
  "San Mateo": "US", "Redwood City": "US", "Sunnyvale": "US", "Berkeley": "US",
  "Oakland": "US", "Hayward": "US", "Fremont": "US", "Foster City": "US",
  "South San Francisco": "US", "San Bruno": "US", "Burlingame": "US",
  "Emeryville": "US", "Los Altos": "US", "Milpitas": "US",
  "Bellevue": "US", "Redmond": "US", "Austin": "US", "Boston": "US",
  "Cambridge": "US", "Denver": "US", "Chicago": "US", "Atlanta": "US",
  "Los Angeles": "US", "San Diego": "US", "Washington, DC": "US",
  "Washington DC": "US", "Raleigh": "US", "Miami": "US", "Detroit": "US",
  "Reston": "US", "Kansas City": "US", "Phoenix": "US", "Santa Clara": "US",
  "Cupertino": "US", "Irvine": "US", "Charlotte": "US", "Milwaukee": "US",
  "Minneapolis": "US", "Orlando": "US", "Nashville": "US", "Honolulu": "US",
  "Hawthorne": "US", "Brownsville": "US", "Cape Canaveral": "US",
  "Starbase": "US", "McGregor": "US", "Bastrop": "US",
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
  "Auckland": "NZ", "Wellington": "NZ",
  "Paris": "FR", "Lyon": "FR",
  "Milan": "IT", "Rome": "IT",
  "Warsaw": "PL", "Krakow": "PL", "Kraków": "PL",
  "Brussels": "BE",
  "Helsinki": "FI",
  "Vienna": "AT",
  "Tokyo": "JP", "Osaka": "JP",
  "Seoul": "KR",
  "Bengaluru": "IN", "Bangalore": "IN", "Hyderabad": "IN", "Mumbai": "IN",
  "Gurugram": "IN", "Gurgaon": "IN",
  "Taipei": "TW", "Hsinchu": "TW"
};

const LOCATION_ALIASES = {
  "nyc": { country: "US", city: "New York" },
  "sf": { country: "US", city: "San Francisco" },
  "bay area": { country: "US", city: "Bay Area" }
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
  "new zealand": { country: "NZ", city: "New Zealand" },
  "france": { country: "FR", city: "France" },
  "italy": { country: "IT", city: "Italy" },
  "poland": { country: "PL", city: "Poland" },
  "belgium": { country: "BE", city: "Belgium" },
  "finland": { country: "FI", city: "Finland" },
  "austria": { country: "AT", city: "Austria" },
  "japan": { country: "JP", city: "Japan" },
  "south korea": { country: "KR", city: "South Korea" },
  "korea, republic of": { country: "KR", city: "South Korea" },
  "india": { country: "IN", city: "India" },
  "taiwan": { country: "TW", city: "Taiwan" }
};

const SEARCH_ALIAS_REPLACEMENTS = [
  ["united states of america", "us"],
  ["united states", "us"],
  ["great britain", "gb"],
  ["united kingdom", "gb"],
  ["u s a", "us"],
  ["u s", "us"],
  ["usa", "us"],
  ["uk", "gb"],
  ["england", "gb"],
  ["nyc", "new york"],
  ["sf", "san francisco"],
  ["rev ops", "revenue operations"],
  ["revops", "revenue operations"],
  ["biz ops", "business operations"],
  ["bizops", "business operations"],
  ["gtm ops", "go to market operations"],
  ["gtm operations", "go to market operations"]
];

const SEARCH_STOP_WORDS = new Set(["a", "an", "and", "for", "in", "of", "the", "to"]);

const EXCLUDED_TITLE_PATTERNS = [
  /\bintern(ship)?\b/,
  /\bapprentice(ship)?\b/,
  /\bgraduate (program|scheme)\b/,
  /\bworking student\b/,
  /\bstudent worker\b/,
  /\bcampus ambassador\b/,
  /\brisk ethics\b/,
  /\badvocacy legal\b/
];

const ROLE_FAMILIES = [
  {
    family: "Engineering",
    patterns: [
      /\b(software|frontend|front end|backend|back end|full stack|fullstack|mobile|ios|android|platform|infrastructure|machine learning|ml|civil|structural|mechanical|electrical|transport|transportation|highway|rail|water|environmental|geotechnical|fire|facade|mep|design|project|process|piping|substation|hardware|systems|aerospace|propulsion|manufacturing|robotics|firmware) engineer\b/,
      /\bsite reliability\b/,
      /\bsre\b/,
      /\bdevops\b/,
      /\bdeveloper\b/,
      /\btechnical lead\b/,
      /\bengineering manager\b/,
      /\bsolutions engineer\b/,
      /\bsales engineer\b/,
      /\bbim designer\b/,
      /\brevit designer\b/,
      /\bsemiconductor\b/,
      /\basic\b/,
      /\bfpga\b/
    ]
  },
  {
    family: "Product",
    patterns: [/\bproduct (manager|owner|lead|strategy|operations|ops)\b/, /\bgroup product\b/]
  },
  {
    family: "Design",
    patterns: [/\b(product|ux|ui|content|brand|visual) designer\b/, /\bdesign manager\b/, /\buser researcher\b/, /\bux researcher\b/]
  },
  {
    family: "Data/Analytics",
    patterns: [/\bdata (analyst|scientist|science|engineer)\b/, /\bbusiness analyst\b/, /\banalytics?\b/, /\bbusiness intelligence\b/, /\bbi analyst\b/, /\banalytics engineer\b/, /\binsights analyst\b/]
  },
  {
    family: "Security/IT",
    patterns: [/\bsecurity\b/, /\bcybersecurity\b/, /\binformation security\b/, /\btrust and safety\b/, /\bit support\b/, /\bsystems administrator\b/, /\bnetwork engineer\b/, /\bcloud infrastructure\b/, /\bprivacy engineer\b/]
  },
  {
    family: "Marketing",
    patterns: [/\bmarketing\b/, /\bgrowth\b/, /\bdemand gen(eration)?\b/, /\bproduct marketing\b/, /\bcontent marketing\b/, /\bfield marketing\b/, /\bbrand marketing\b/, /\bmarketing operations\b/, /\bmarketing ops\b/, /\bseo\b/, /\bperformance marketing\b/, /\blifecycle marketing\b/]
  },
  {
    family: "Finance",
    patterns: [/\bfp\s*a\b/, /\bfpa\b/, /\bfinancial planning\b/, /\baccounting\b/, /\baccountant\b/, /\bcontroller\b/, /\bstrategic finance\b/, /\brevenue finance\b/, /\bdeal desk\b/, /\bcorporate finance\b/, /\btax\b/, /\btreasury\b/, /\bprocurement\b/, /\bpayroll\b/, /\bfinance (manager|analyst)\b/]
  },
  {
    family: "Customer Success/Support",
    patterns: [/\bcustomer success\b/, /\bcustomer support\b/, /\btechnical support\b/, /\bsupport engineer\b/, /\bimplementation\b/, /\bonboarding\b/, /\bsolutions consultant\b/, /\bprofessional services\b/, /\bcustomer experience\b/, /\brenewals\b/, /\bsupport manager\b/]
  },
  {
    family: "Operations",
    patterns: [/\bsalesforce administrator\b/, /\brevenue operations\b/, /\brev ?ops\b/, /\bbusiness operations\b/, /\bbiz ?ops\b/, /\bgtm operations\b/, /\bgtm ops\b/, /\bgo to market operations\b/, /\bgo market operations\b/, /\bsales operations\b/, /\bsales ops\b/, /\bfield operations\b/, /\bworkplace operations\b/, /\boperations\b/]
  },
  {
    family: "People/HR",
    patterns: [/\bpeople\b/, /\bhuman resources\b/, /\bhr business partner\b/, /\btalent acquisition\b/, /\brecruiter\b/, /\brecruiting\b/, /\bcompensation\b/, /\bbenefits\b/, /\bpeople operations\b/, /\bemployee experience\b/, /\blearning and development\b/]
  },
  {
    family: "Legal/Compliance",
    patterns: [/\blegal counsel\b/, /\bsenior legal counsel\b/, /\bcommercial counsel\b/, /\bprivacy counsel\b/, /\bcompliance\b/, /\bregulatory\b/, /\brisk manager\b/, /\blegal operations\b/, /\bcontract manager\b/]
  },
  {
    family: "Strategy/Program",
    patterns: [/\bstrategy\b/, /\bstrategic programs\b/, /\bprogram manager\b/, /\bproject manager\b/, /\bchief of staff\b/, /\bbusiness planning\b/, /\brevenue strategy\b/, /\bstrategy and operations\b/]
  },
  {
    family: "Sales",
    patterns: [/\baccount executive\b/, /\bsales\b/, /\bbusiness development\b/, /\bbdr\b/, /\bsdr\b/, /\baccount manager\b/, /\bpartnerships\b/, /\bpartner manager\b/, /\benterprise account\b/, /\bcommercial account\b/, /\bsales strategy\b/, /\bsales excellence\b/]
  }
];

const ROLE_FALLBACK_KEYWORDS = [
  "engineer", "developer", "designer", "analyst", "manager", "lead", "director",
  "specialist", "associate", "consultant", "architect", "administrator"
];

const COMPANY_ALIASES = {
  talkdesk2: "talkdesk",
  boxinc: "box",
  aws: "amazon",
  "aws / amazon": "amazon"
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
  "xero", "canva", "wise", "google", "meta", "amazon", "apple",
  "microsoft", "linkedin", "stripe", "salesforce", "adobe", "servicenow",
  "atlassian", "shopify", "pinterest", "nvidia", "tesla", "openai",
  "anthropic", "cursor", "perplexity"
]);

const LIKELY_VISA_COMPANIES = new Set([
  "gongio", "klaviyo", "pleo", "celonis", "airtable", "brex", "mercury",
  "vercel", "typeform", "feedzai", "mentimeter", "trustpilot", "asana",
  "remote", "sumologic", "contentful", "n26", "cognite", "linear",
  "mollie", "notion", "ramp", "pipedrive", "talkdesk", "box",
  "netflix", "spacex"
]);

const SCALEUP_COMPANIES = new Set([
  "celonis", "airtable", "gitlab", "figma", "linear", "ramp", "brex",
  "mercury", "vercel", "travelperk", "glovo", "feedzai", "unbabel",
  "klarna", "templafy", "remote", "monday", "contentful", "n26",
  "cognite", "wise", "bolt", "canva", "asana", "shopify"
]);

function matchCountry(locationName) {
  if (!locationName) return null;
  const parts = splitLocationParts(locationName);
  for (const part of parts) {
    const loc = matchCityInLocation(part);
    if (loc) return loc;
  }
  for (const part of parts) {
    const loc = matchLocationAlias(part);
    if (loc) return loc;
  }
  for (const part of parts) {
    const loc = matchCountryHintInLocation(part);
    if (loc) return loc;
  }
  return null;
}

function splitLocationParts(locationName) {
  const raw = String(locationName || "");
  const normalizedSeparators = raw
    .replace(/\(([^)]+)\)/g, " | $1 | ")
    .replace(/\b,\s*remote\b/gi, " | remote")
    .split(/\s*(?:\/|\||;|,)\s*/);
  const parts = [...normalizedSeparators, raw];
  return [...new Set(parts.map(part => part.trim()).filter(Boolean))];
}

function matchCityInLocation(locationPart) {
  const raw = String(locationPart || "").toLowerCase();
  const normalized = normalizeSearchText(locationPart);
  const matches = Object.entries(CITY_TO_COUNTRY)
    .filter(([city]) => matchesNormalizedToken(normalized, normalizeSearchText(city)))
    .map(([city, code]) => ({
      city,
      code,
      exact: raw.includes(city.toLowerCase()),
      normalizedLength: normalizeSearchText(city).length
    }))
    .sort((a, b) => Number(b.exact) - Number(a.exact)
      || b.normalizedLength - a.normalizedLength
      || b.city.length - a.city.length);
  return matches.length ? { country: matches[0].code, city: matches[0].city } : null;
}

function matchCountryHintInLocation(locationPart) {
  const normalized = normalizeSearchText(locationPart);
  for (const [hint, loc] of Object.entries(COUNTRY_HINTS)) {
    if (matchesNormalizedToken(normalized, normalizeSearchText(hint))) return loc;
  }
  return null;
}

function matchLocationAlias(locationPart) {
  const normalized = normalizeSearchText(locationPart);
  for (const [hint, loc] of Object.entries(LOCATION_ALIASES)) {
    if (matchesNormalizedToken(normalized, normalizeSearchText(hint))) return loc;
  }
  return null;
}

function matchesNormalizedToken(normalizedText, normalizedHint) {
  return new RegExp(`(^| )${escapeRegExp(normalizedHint)}(?= |$)`).test(normalizedText);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classifyRoleFamily(title) {
  if (!title) return false;
  const t = normalizeSearchText(title);
  if (EXCLUDED_TITLE_PATTERNS.some(pattern => pattern.test(t))) return false;
  for (const group of ROLE_FAMILIES) {
    if (group.patterns.some(pattern => pattern.test(t))) return group.family;
  }
  return ROLE_FALLBACK_KEYWORDS.some(k => matchesNormalizedToken(t, normalizeSearchText(k))) ? "Other" : null;
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

function classifyNiche(token) {
  const company = canonicalCompany(token);
  if (["openai", "anthropic", "cursor", "perplexity"].includes(company)) return FRONTIER_AI_NICHE;
  return TECH_NICHE;
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

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function applySearchAliases(value) {
  let normalized = normalizeSearchText(value);
  for (const [from, to] of SEARCH_ALIAS_REPLACEMENTS) {
    normalized = normalized.replace(new RegExp(`(^| )${escapeRegExp(from)}(?= |$)`, "g"), `$1${to}`);
  }
  return normalized.trim().replace(/\s+/g, " ");
}

function searchTokens(value) {
  const normalized = applySearchAliases(value);
  return normalized
    .split(" ")
    .map(token => token.trim())
    .filter(token => token && !SEARCH_STOP_WORDS.has(token) && (token.length > 1 || /\d/.test(token)));
}

function matchesSearchTokens(haystack, tokens) {
  if (!tokens.length) return true;
  const normalizedHaystack = ` ${applySearchAliases(haystack)} `;
  return tokens.every(token => normalizedHaystack.includes(` ${token} `));
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
    niche: classifyNiche(token),
    fetch: s => fetcher(s.token, s.fetchMeta)
  };
}

function customTechSource({ source, token, company, tier = "BigTech", visa, niche = TECH_NICHE, fetch }) {
  return {
    source,
    token,
    company,
    industry: INDUSTRIES.TECH,
    niche,
    tier,
    visa,
    fetch
  };
}

function engineeringAtsSource({ source, token, company, niche, tier = "BigTech", visa, fetcher }) {
  return {
    source,
    token,
    company,
    industry: INDUSTRIES.ENGINEERING,
    niche,
    tier,
    visa,
    fetch: s => fetcher(s.token, s.fetchMeta)
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

function scanSources() {
  return [
    ...GREENHOUSE_TOKENS.map(t => techSource("greenhouse", t, fetchGreenhouse)),
    ...ASHBY_TOKENS.map(t => techSource("ashby", t, fetchAshby)),
    ...LEVER_TOKENS.map(t => techSource("lever", t, fetchLever)),
    ...SMARTRECRUITERS_TOKENS.map(t => techSource("smartrecruiters", t, fetchSmartRecruiters)),
    ...POPULAR_TECH_SOURCES,
    ...YC_SOURCES,
    ...ENGINEERING_SOURCES
  ];
}

export function scanSourceInventory() {
  return scanSources().map(source => ({
    id: sourceId(source),
    source: source.source,
    token: source.token,
    company: source.company || canonicalCompany(source.token),
    industry: source.industry || INDUSTRIES.TECH,
    niche: source.niche || TECH_NICHE,
    tier: source.tier || classifyTier(source.token),
    visa: source.visa || classifyVisa(source.token)
  }));
}

// ------------------------------------------------------------------
// D1 scan persistence
// ------------------------------------------------------------------

function db(env) {
  return env.DB || null;
}

function jsonText(value) {
  return JSON.stringify(value ?? null);
}

async function dbRun(env, sql, ...params) {
  const database = db(env);
  if (!database) return null;
  return database.prepare(sql).bind(...params).run();
}

async function dbFirst(env, sql, ...params) {
  const database = db(env);
  if (!database) return null;
  return database.prepare(sql).bind(...params).first();
}

async function dbAll(env, sql, ...params) {
  const database = db(env);
  if (!database) return [];
  const result = await database.prepare(sql).bind(...params).all();
  return result?.results || [];
}

async function dbBatch(env, statements) {
  const database = db(env);
  if (!database || !statements.length) return;
  if (typeof database.batch === "function") {
    await database.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

async function persistScanToD1(env, scanResult, today) {
  const database = db(env);
  if (!database) return;

  const postings = Object.values(scanResult.postings);
  if (!postings.length) return;

  const now = new Date().toISOString();
  const statements = [];

  for (const p of postings) {
    statements.push(database.prepare(`
      insert into job_postings (
        id, source, source_token, company, title, url, industry, niche,
        first_seen_date, last_seen_date, last_filled_date, is_active, created_at, updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        source = excluded.source,
        source_token = excluded.source_token,
        company = excluded.company,
        title = excluded.title,
        url = excluded.url,
        industry = excluded.industry,
        niche = excluded.niche,
        first_seen_date = excluded.first_seen_date,
        last_seen_date = excluded.last_seen_date,
        last_filled_date = excluded.last_filled_date,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `).bind(
      p.id,
      p.source,
      p.source_token || p.company,
      p.company,
      p.title,
      p.url,
      p.industry || INDUSTRIES.TECH,
      p.niche || TECH_NICHE,
      p.first_seen,
      p.last_seen,
      p.last_filled || null,
      p.last_filled ? 0 : 1,
      now,
      now
    ));

    statements.push(database.prepare(`
      insert into job_snapshots (
        job_id, scan_date, title, location, city, country, industry, niche,
        role_family, seniority, visa, score, tier, is_new, is_filled, created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(job_id, scan_date) do update set
        title = excluded.title,
        location = excluded.location,
        city = excluded.city,
        country = excluded.country,
        industry = excluded.industry,
        niche = excluded.niche,
        role_family = excluded.role_family,
        seniority = excluded.seniority,
        visa = excluded.visa,
        score = excluded.score,
        tier = excluded.tier,
        is_new = excluded.is_new,
        is_filled = excluded.is_filled
    `).bind(
      p.id,
      today,
      p.title,
      p.location || null,
      p.city || null,
      p.country,
      p.industry || INDUSTRIES.TECH,
      p.niche || TECH_NICHE,
      p.role_family,
      p.seniority,
      p.visa,
      p.score,
      p.tier,
      p.first_seen === today ? 1 : 0,
      p.last_filled ? 1 : 0,
      now
    ));
  }

  await dbBatch(env, statements);

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

  await dbRun(env, `
    insert into daily_scan_stats (
      scan_date, total_jobs, new_jobs, filled_jobs, per_source, per_industry,
      per_niche, per_country, per_family, per_tier, ok_count, fail_count, created_at, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(scan_date) do update set
      total_jobs = excluded.total_jobs,
      new_jobs = excluded.new_jobs,
      filled_jobs = excluded.filled_jobs,
      per_source = excluded.per_source,
      per_industry = excluded.per_industry,
      per_niche = excluded.per_niche,
      per_country = excluded.per_country,
      per_family = excluded.per_family,
      per_tier = excluded.per_tier,
      ok_count = excluded.ok_count,
      fail_count = excluded.fail_count,
      updated_at = excluded.updated_at
  `,
    today,
    postings.length,
    newJobs,
    filledJobs,
    jsonText(perSource),
    jsonText(perIndustry),
    jsonText(perNiche),
    jsonText(perCountry),
    jsonText(perFamily),
    jsonText(perTier),
    scanResult.scan_meta?.okCount || 0,
    scanResult.scan_meta?.failCount || 0,
    now,
    now
  );
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

function recordFetchFailure(diagnostics, failure) {
  if (!diagnostics) return;
  diagnostics.failures ||= [];
  diagnostics.failures.push({
    url: String(failure.url || ""),
    reason: failure.reason || "fetch_error",
    ...(failure.status ? { status: failure.status } : {})
  });
}

async function fetchWithTimeout(url, init = {}, diagnostics = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { cf: { cacheTtl: 0 }, ...init, signal: controller.signal });
    if (!r.ok) {
      recordFetchFailure(diagnostics, { url, reason: "http_error", status: r.status });
      return null;
    }
    return r;
  } catch (error) {
    recordFetchFailure(diagnostics, {
      url,
      reason: error?.name === "AbortError" ? "timeout" : "fetch_error"
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJSON(url, init = {}, diagnostics = null) {
  const r = await fetchWithTimeout(url, init, diagnostics);
  if (!r) return null;
  try {
    return await r.json();
  } catch {
    recordFetchFailure(diagnostics, { url, reason: "invalid_json" });
    return null;
  }
}

async function fetchText(url, diagnostics = null) {
  const r = await fetchWithTimeout(url, {}, diagnostics);
  if (!r) return null;
  try {
    return await r.text();
  } catch {
    recordFetchFailure(diagnostics, { url, reason: "invalid_text" });
    return null;
  }
}

function normalizeFetchResult(result) {
  if (Array.isArray(result)) return { jobs: result, meta: null };
  if (result && Array.isArray(result.jobs)) {
    return { jobs: result.jobs, meta: result.meta || null };
  }
  return { jobs: null, meta: null };
}

function sourceDiagnosticsMeta(fetchMeta) {
  const failures = Array.isArray(fetchMeta?.failures) ? fetchMeta.failures : [];
  if (!failures.length) return null;
  return {
    fetchFailures: failures.slice(0, 10),
    lastFailure: failures[failures.length - 1]
  };
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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)))
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

function extractDataPage(html) {
  const match = String(html || "").match(/data-page=(["'])([\s\S]*?)\1/);
  if (!match) return null;
  try {
    return JSON.parse(decodeHTML(match[2]));
  } catch {
    return null;
  }
}

function extractYcJobPostings(html) {
  const dataPage = extractDataPage(html);
  const jobs = dataPage?.props?.jobPostings;
  return Array.isArray(jobs) ? jobs : null;
}

function extractBalancedJson(text, start) {
  if (start < 0 || text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseEmbeddedJsonObject(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const objectStart = text.lastIndexOf("{", markerIndex);
  const json = extractBalancedJson(text, objectStart);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function extractAppleSearchData(html) {
  const decoded = decodeHTML(html);
  const candidates = [
    decoded,
    decoded.replace(/\\"/g, "\"")
  ];
  for (const text of candidates) {
    const direct = parseEmbeddedJsonObject(text, "\"searchResults\":");
    if (Array.isArray(direct?.searchResults)) return direct;
    if (Array.isArray(direct?.search?.searchResults)) return direct.search;
  }
  return null;
}

function extractNetflixSmartApplyData(html) {
  const match = String(html || "").match(/<code[^>]+id=["']smartApplyData["'][^>]*>([\s\S]*?)<\/code>/i);
  if (!match) return null;
  try {
    return JSON.parse(decodeHTML(match[1]));
  } catch {
    return null;
  }
}

function ycCompanySlug(job) {
  const value = job.companyUrl || job.url || "";
  return String(value).match(/\/companies\/([^/?#]+)/)?.[1] || "";
}

function buildYcCompanyMap(companies) {
  if (!Array.isArray(companies)) return new Map();
  return new Map(companies
    .filter(company => company?.slug)
    .map(company => [company.slug, company]));
}

function normalizeCompanyKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function classifyYcTier(company) {
  const companyKey = normalizeCompanyKey(company?.name);
  if (GROWTH_SAAS_COMPANIES.has(companyKey)) return "GrowthSaaS";
  if (SCALEUP_COMPANIES.has(companyKey)) return "Scaleup";

  const teamSize = Number(company?.team_size);
  if (company?.stage === "Growth" || (Number.isFinite(teamSize) && teamSize >= 200)) {
    return "Scaleup";
  }

  const companyText = [
    company?.industry,
    company?.subindustry,
    ...(company?.industries || []),
    ...(company?.tags || [])
  ].join(" ").toLowerCase();

  if (/\b(b2b|saas|api|developer tools|sales|marketing|productivity|hr|human resources|fintech|analytics|data)\b/.test(companyText)) {
    return "GrowthSaaS";
  }

  return "Scaleup";
}

function classifyYcVisa(job) {
  const visaText = String(job.visa || "").toLowerCase();
  if (visaText.includes("will sponsor")) return "Strong";
  if (visaText.includes("not required") || job.askUs === true) return "Likely";
  return "Unknown";
}

function classifyYcRoleFamily(job) {
  const prettyRole = String(job.prettyRole || job.roleSpecificType || job.role || "").toLowerCase();
  if (prettyRole.includes("engineer") || prettyRole === "eng" || prettyRole.includes("software")) return "Engineering";
  if (prettyRole.includes("product")) return "Product";
  if (prettyRole.includes("design")) return "Design";
  if (prettyRole.includes("sales")) return "Sales";
  if (prettyRole.includes("marketing")) return "Marketing";
  if (prettyRole.includes("support") || prettyRole.includes("success")) return "Customer Success/Support";
  if (prettyRole.includes("recruit") || prettyRole.includes("hr") || prettyRole.includes("people")) return "People/HR";
  if (prettyRole.includes("operations")) return "Operations";
  if (prettyRole.includes("science") || prettyRole.includes("data")) return "Data/Analytics";
  return classifyRoleFamily(job.title);
}

function normalizeYcLocation(job, company) {
  const location = String(job.location || "").trim();
  if (location && !/^(remote|anywhere|worldwide)$/i.test(location)) return location;
  return company?.all_locations || location;
}

function normalizeYcJob(job, companyMap) {
  const slug = ycCompanySlug(job);
  const company = companyMap.get(slug);
  const title = String(job.title || "").trim();
  const rawUrl = String(job.url || "").trim();
  if (!job.id || !title || !rawUrl) return null;
  const url = absoluteUrl(YC_BASE_URL, rawUrl);

  return {
    id: String(job.id),
    title,
    location: normalizeYcLocation(job, company),
    url,
    company: job.companyName || company?.name || slug,
    tier: classifyYcTier(company || { name: job.companyName }),
    role_family: classifyYcRoleFamily(job),
    seniority: classifySeniority(title),
    visa: classifyYcVisa(job),
    industry: INDUSTRIES.TECH,
    niche: TECH_NICHE
  };
}

async function fetchYcStartupJobs(source = {}) {
  const diagnostics = source.fetchMeta;
  const [companies, pageResults] = await Promise.all([
    fetchJSON(YC_COMPANIES_URL, {}, diagnostics),
    Promise.allSettled(YC_SEED_PATHS.map(async path => {
      const url = absoluteUrl(YC_BASE_URL, path);
      const html = await fetchText(url, diagnostics);
      const jobPostings = extractYcJobPostings(html);
      if (html && !Array.isArray(jobPostings)) {
        recordFetchFailure(diagnostics, { url, reason: "parse_miss" });
      }
      return { path, ok: Array.isArray(jobPostings), jobPostings: jobPostings || [] };
    }))
  ]);

  const companyMap = buildYcCompanyMap(companies);
  const jobs = [];
  const failedPages = [];
  let okPages = 0;

  for (const result of pageResults) {
    if (result.status !== "fulfilled" || !result.value.ok) {
      failedPages.push(result.status === "fulfilled" ? result.value.path : "unknown");
      continue;
    }
    okPages++;
    for (const job of result.value.jobPostings) {
      const normalized = normalizeYcJob(job, companyMap);
      if (normalized) jobs.push(normalized);
    }
  }

  if (!okPages) return null;

  return {
    jobs: uniqueJobs(jobs),
    meta: {
      okPages,
      failedPages,
      totalPages: YC_SEED_PATHS.length,
      companiesLoaded: companyMap.size
    }
  };
}

async function fetchGreenhouse(token, diagnostics = null) {
  const data = await fetchJSON(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`, {}, diagnostics);
  if (!data) return null;
  return (data.jobs || []).map(j => ({
    id: String(j.id),
    title: j.title,
    location: j.location?.name,
    url: j.absolute_url
  }));
}

async function fetchAshby(token, diagnostics = null) {
  const data = await fetchJSON(`https://api.ashbyhq.com/posting-api/job-board/${token}`, {}, diagnostics);
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

async function fetchAmazonJobs(source = {}) {
  const diagnostics = source.fetchMeta;
  const out = [];
  let okPages = 0;
  const failedPages = [];
  for (const loc of AMAZON_SEARCH_LOCATIONS) {
    const params = new URLSearchParams({
      base_query: "",
      loc_query: loc,
      result_limit: "10",
      offset: "0"
    });
    const url = `https://www.amazon.jobs/en/search.json?${params.toString()}`;
    const data = await fetchJSON(url, {}, diagnostics);
    if (!data) {
      failedPages.push(loc);
      continue;
    }
    okPages++;
    for (const job of data.jobs || []) {
      const id = job.id || job.id_icims || job.job_path;
      const title = job.title;
      const location = job.normalized_location || job.location || [job.city, job.state, job.country_code].filter(Boolean).join(", ");
      const jobUrl = job.job_path ? absoluteUrl("https://www.amazon.jobs", job.job_path) : job.url_next_step;
      out.push({ id: String(id), title, location, url: jobUrl });
      if (out.length >= CUSTOM_SOURCE_LIMIT) break;
    }
    if (out.length >= CUSTOM_SOURCE_LIMIT) break;
  }
  if (!okPages) return null;
  return {
    jobs: uniqueJobs(out),
    meta: {
      okPages,
      failedPages,
      totalPages: AMAZON_SEARCH_LOCATIONS.length,
      truncated: out.length >= CUSTOM_SOURCE_LIMIT
    }
  };
}

async function fetchAppleJobs(source = {}) {
  const diagnostics = source.fetchMeta;
  const out = [];
  const failedPages = [];
  let okPages = 0;
  for (const path of APPLE_SEARCH_PATHS) {
    const url = absoluteUrl("https://jobs.apple.com", path);
    const html = await fetchText(url, diagnostics);
    const data = html ? extractAppleSearchData(html) : null;
    if (!data || !Array.isArray(data.searchResults)) {
      if (html) recordFetchFailure(diagnostics, { url, reason: "parse_miss" });
      failedPages.push(path);
      continue;
    }
    okPages++;
    for (const job of data.searchResults) {
      const locations = Array.isArray(job.locations) && job.locations.length ? job.locations : [null];
      locations.forEach((loc, i) => {
        const location = loc ? [loc.name, loc.city, loc.stateProvince, loc.countryName].filter(Boolean).join(", ") : "";
        const titleSlug = job.transformedPostingTitle || "";
        const urlPath = `/en-us/details/${job.positionId}/${titleSlug}`;
        out.push({
          id: `${job.positionId || job.id}-${loc?.postLocationId || i}`,
          title: job.postingTitle,
          location,
          url: absoluteUrl("https://jobs.apple.com", urlPath)
        });
      });
      if (out.length >= CUSTOM_SOURCE_LIMIT) break;
    }
    if (out.length >= CUSTOM_SOURCE_LIMIT) break;
  }
  if (!okPages) return null;
  return {
    jobs: uniqueJobs(out),
    meta: {
      okPages,
      failedPages,
      totalPages: APPLE_SEARCH_PATHS.length,
      truncated: out.length >= CUSTOM_SOURCE_LIMIT
    }
  };
}

async function fetchNetflixJobs(source = {}) {
  const diagnostics = source.fetchMeta;
  const url = "https://explore.jobs.netflix.net/careers";
  const html = await fetchText(url, diagnostics);
  const data = html ? extractNetflixSmartApplyData(html) : null;
  if (!data || !Array.isArray(data.positions)) {
    if (html) recordFetchFailure(diagnostics, { url, reason: "parse_miss" });
    return null;
  }
  const out = [];
  for (const job of data.positions) {
    const locations = Array.isArray(job.locations) && job.locations.length ? job.locations : [job.location];
    locations.filter(Boolean).forEach((loc, i) => {
      out.push({
        id: `${job.id || job.ats_job_id}-${i}`,
        title: job.posting_name || job.name,
        location: loc,
        url: job.canonicalPositionUrl || absoluteUrl(url, `/careers/job/${job.id}`)
      });
    });
    if (out.length >= CUSTOM_SOURCE_LIMIT) break;
  }
  return {
    jobs: uniqueJobs(out),
    meta: {
      okPages: 1,
      failedPages: [],
      totalPages: 1,
      parsedCount: data.positions.length,
      truncated: out.length >= CUSTOM_SOURCE_LIMIT
    }
  };
}

async function fetchRmkCategory(source) {
  const html = await fetchText(source.url, source.fetchMeta);
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
    const html = await fetchText(url, source.fetchMeta);
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
    const html = await fetchText(pageUrl, source.fetchMeta);
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
  }, source.fetchMeta);
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

async function fetchLever(token, diagnostics = null) {
  const data = await fetchJSON(`https://api.lever.co/v0/postings/${token}?mode=json`, {}, diagnostics);
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

async function fetchSmartRecruiters(token, diagnostics = null) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 10; page++) {
    const data = await fetchJSON(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100&offset=${offset}`, {}, diagnostics);
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
  const sourceMeta = {};
  let okCount = 0;
  let failCount = 0;

  const sources = scanSources();

  for (let i = 0; i < sources.length; i += 8) {
    const batch = sources.slice(i, i + 8);
    const results = await Promise.allSettled(batch.map(async s => {
      const sourceForFetch = { ...s, fetchMeta: { failures: [] } };
      try {
        const result = normalizeFetchResult(await sourceForFetch.fetch(sourceForFetch));
        return { s, fetchMeta: sourceForFetch.fetchMeta, ...result };
      } catch {
        return { s, fetchMeta: sourceForFetch.fetchMeta, jobs: null };
      }
    }));

    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value.jobs) {
        failCount++;
        const failed = r.status === "fulfilled" ? r.value.s : null;
        if (failed) {
          failedSources.add(sourceId(failed));
          const failureMeta = sourceDiagnosticsMeta(r.value.fetchMeta);
          if (failureMeta) sourceMeta[sourceId(failed)] = failureMeta;
        }
        continue;
      }
      okCount++;
      const { s, jobs, meta, fetchMeta } = r.value;
      const sid = sourceId(s);
      okSources.add(sid);
      const diagnostics = sourceDiagnosticsMeta(fetchMeta);
      if (meta || diagnostics) sourceMeta[sid] = { ...(meta || {}), ...(diagnostics || {}) };
      let retainedForSource = 0;
      for (const job of jobs) {
        const loc = matchCountry(job.location);
        if (!loc) continue;
        const roleFamily = job.role_family || classifyRoleFamily(job.title);
        if (!roleFamily) continue;

        const id = `${s.source}-${s.token}-${job.id}`;
        const existed = prev.postings[id];
        const visa = job.visa || s.visa || classifyVisa(s.token);
        const firstSeen = existed?.first_seen || today;
        const seniority = job.seniority || classifySeniority(job.title);
        const industry = job.industry || s.industry || INDUSTRIES.TECH;
        const niche = job.niche || s.niche || TECH_NICHE;

        found[id] = {
          id,
          source: s.source,
          source_token: s.token,
          company: job.company || s.company || canonicalCompany(s.token),
          title: job.title,
          location: job.location,
          city: loc.city,
          country: loc.country,
          url: job.url,
          tier: job.tier || s.tier || classifyTier(s.token),
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
        retainedForSource++;
        if (retainedForSource >= MAX_POSTINGS_PER_SOURCE) {
          sourceMeta[sid] = {
            ...(sourceMeta[sid] || {}),
            retainedLimit: MAX_POSTINGS_PER_SOURCE,
            sourceJobs: jobs.length
          };
          break;
        }
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
    if (sourceMeta[postingSourceId(p)]?.failedPages?.length) {
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
      failedSources: [...failedSources],
      sourceMeta
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
  NZ: "New Zealand",
  FR: "France",
  IT: "Italy",
  PL: "Poland",
  BE: "Belgium",
  FI: "Finland",
  AT: "Austria",
  JP: "Japan",
  KR: "South Korea",
  IN: "India",
  TW: "Taiwan"
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
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://*.clerk.accounts.dev https://*.clerk.com https://clerk.livejobindex.com https://accounts.livejobindex.com https://www.googletagmanager.com https://www.google-analytics.com https://www.clarity.ms https://static.cloudflareinsights.com",
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.livejobindex.com https://accounts.livejobindex.com https://api.clerk.com https://img.clerk.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.clarity.ms https://cloudflareinsights.com",
  "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.livejobindex.com https://accounts.livejobindex.com",
  "img-src 'self' data: https: https://img.clerk.com",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:"
].join("; ");

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  return withTrustHeaders(new Response(JSON.stringify(data), { ...init, headers }));
}

function errorResponse(status, message) {
  const safeMessage = status >= 500 && !SAFE_SERVER_ERRORS.has(message) ? "internal_error" : message;
  return jsonResponse({ error: safeMessage }, { status });
}

function redirectResponse(location, status = 303) {
  const headers = new Headers({ Location: location });
  return withTrustHeaders(new Response(null, { status, headers }));
}

function parseCookieHeader(header) {
  if (!header) return [];
  return header.split(";").map(part => {
    const [rawName, ...rawValue] = part.trim().split("=");
    const name = rawName?.trim();
    if (!name) return null;
    return { name, value: decodeURIComponent(rawValue.join("=") || "") };
  }).filter(Boolean);
}

function serializeCookieHeader(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) {
    const sameSite = String(options.sameSite).toLowerCase();
    parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);
  }
  return parts.join("; ");
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
  const search = cleanString(payload.search || filters.search);
  return {
    page: clampInteger(payload.page, 1, 1, 10000),
    per_page: clampInteger(payload.per_page, JOB_PAGE_SIZE, 1, MAX_JOB_PAGE_SIZE),
    sort: ["score", "company", "title", "role", "country", "status", "first_seen"].includes(payload.sort) ? payload.sort : "score",
    dir: payload.dir === "asc" ? "asc" : "desc",
    search,
    searchTokens: searchTokens(search),
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
  if (query.searchTokens.length) {
    const blob = [
      posting.company,
      posting.title,
      posting.city,
      posting.location,
      posting.country,
      COUNTRY_NAMES[posting.country],
      industry,
      niche,
      tier,
      posting.role_family,
      posting.seniority,
      posting.visa
    ].join(" ").toLowerCase();
    if (!matchesSearchTokens(blob, query.searchTokens)) return false;
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

function isLowBotScore(request) {
  const bot = request.cf?.botManagement;
  if (!bot || bot.verifiedBot) return false;
  const score = Number(bot.score);
  return Number.isFinite(score) && score > 0 && score < 30;
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

function safeRedirectPath(value) {
  const path = cleanString(value || "/", 300);
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
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
  return allowed.size > 0 && email && allowed.has(email) ? null : errorResponse(403, "forbidden");
}

function authTokenFromRequest(request) {
  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return bearer.trim();
  return cookieValue(request, "__session");
}

function clerkAuthorizedParties(request, env) {
  const configured = String(env.CLERK_AUTHORIZED_PARTIES || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  if (configured.length) return configured;
  const url = new URL(request.url);
  const localOrigin = /^(localhost|127\.0\.0\.1)$/.test(url.hostname) ? url.origin : null;
  return [SITE_ORIGIN, "https://www.livejobindex.com", localOrigin].filter(Boolean);
}

async function fetchClerkUser(userId, env) {
  if (env.CLERK_USERS?.[userId]) return env.CLERK_USERS[userId];
  if (!env.CLERK_SECRET_KEY) return null;
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  return clerk.users.getUser(userId);
}

function clerkUserName(clerkUser) {
  const fullName = cleanString(clerkUser?.fullName || clerkUser?.full_name, 180);
  if (fullName) return fullName;
  return [clerkUser?.firstName || clerkUser?.first_name, clerkUser?.lastName || clerkUser?.last_name]
    .map(part => cleanString(part, 90))
    .filter(Boolean)
    .join(" ") || null;
}

function clerkUserEmail(clerkUser) {
  const direct = cleanString(clerkUser?.email, 320);
  if (direct) return direct;
  const primaryId = clerkUser?.primaryEmailAddressId || clerkUser?.primary_email_address_id;
  const emails = clerkUser?.emailAddresses || clerkUser?.email_addresses || [];
  const primary = emails.find(email => (email.id || email.emailAddress) === primaryId) || emails[0];
  return cleanString(primary?.emailAddress || primary?.email_address, 320);
}

async function requireUser(request, env) {
  if (env.CLERK_USER) {
    const user = {
      id: env.CLERK_USER.id,
      email: env.CLERK_USER.email || "",
      full_name: cleanString(env.CLERK_USER.full_name || env.CLERK_USER.name, 180) || null
    };
    return { context: {}, user };
  }

  const token = authTokenFromRequest(request);
  if (!token) return { response: errorResponse(401, "unauthorized") };

  try {
    const claims = env.CLERK_VERIFY_TOKEN
      ? await env.CLERK_VERIFY_TOKEN(token, request)
      : await verifyToken(token, {
        jwtKey: env.CLERK_JWT_KEY,
        secretKey: env.CLERK_SECRET_KEY,
        authorizedParties: clerkAuthorizedParties(request, env)
      });
    const userId = cleanString(claims?.sub, 160);
    if (!userId) return { response: errorResponse(401, "unauthorized") };

    const clerkUser = await fetchClerkUser(userId, env).catch(() => null);
    const user = {
      id: userId,
      email: clerkUserEmail(clerkUser) || cleanString(claims.email, 320) || "",
      full_name: clerkUserName(clerkUser) || cleanString(claims.name || claims.full_name, 180) || null
    };
    return { context: {}, user };
  } catch {
    return { response: errorResponse(401, "unauthorized") };
  }
}

function parseJSONCell(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeUserRow(row) {
  if (!row) return null;
  return {
    ...row,
    onboarding_completed: Boolean(row.onboarding_completed)
  };
}

function normalizeAccessRow(row) {
  if (!row) return null;
  return {
    ...row,
    api_access_enabled: Boolean(row.api_access_enabled),
    integrations_enabled: Boolean(row.integrations_enabled)
  };
}

function normalizeIndividualProfile(row) {
  if (!row) return null;
  return {
    ...row,
    years_experience: Number(row.years_experience),
    target_role_families: parseJSONCell(row.target_role_families, []),
    target_countries: parseJSONCell(row.target_countries, []),
    visa_needed: Boolean(row.visa_needed),
    salary_min_usd: row.salary_min_usd == null ? null : Number(row.salary_min_usd)
  };
}

function normalizeAgencyProfile(row) {
  if (!row) return null;
  return {
    ...row,
    target_markets: parseJSONCell(row.target_markets, []),
    target_role_families: parseJSONCell(row.target_role_families, []),
    target_countries: parseJSONCell(row.target_countries, [])
  };
}

function normalizeUserJob(row) {
  if (!row) return null;
  return {
    ...row,
    starred: Boolean(row.starred)
  };
}

async function insertJobHistory(env, userId, jobId, eventType, fromStatus = null, toStatus = null) {
  await dbRun(env, `
    insert into user_job_history (id, user_id, job_id, event_type, from_status, to_status, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `, crypto.randomUUID(), userId, jobId, eventType, fromStatus, toStatus, new Date().toISOString());
}

async function ensureAccountRows(env, user, accountType = "individual") {
  const now = new Date().toISOString();
  const safeAccountType = ACCOUNT_TYPES.has(accountType) ? accountType : "individual";
  await dbRun(env, `
    insert into users (
      id, email, full_name, last_login_at, onboarding_completed, account_type,
      brand_theme, created_at, updated_at
    )
    values (?, ?, ?, null, 0, ?, 'cobalt', ?, ?)
    on conflict(id) do update set
      email = excluded.email,
      full_name = coalesce(excluded.full_name, users.full_name),
      updated_at = excluded.updated_at
  `, user.id, user.email || "", user.full_name || null, safeAccountType, now, now);

  await dbRun(env, `
    insert into account_access (
      user_id, plan, account_type, api_access_enabled, integrations_enabled,
      export_enabled, rate_limit_tier, created_at, updated_at
    )
    values (?, 'free', ?, 0, 0, ?, 'free', ?, ?)
    on conflict(user_id) do nothing
  `, user.id, safeAccountType, safeAccountType === "agency" ? "limited" : "none", now, now);
}

async function syncAccountAccessType(env, userId, accountType) {
  const now = new Date().toISOString();
  const exportEnabled = accountType === "agency" ? "limited" : "none";
  await dbRun(env, `
    insert into account_access (
      user_id, plan, account_type, api_access_enabled, integrations_enabled,
      export_enabled, rate_limit_tier, created_at, updated_at
    )
    values (?, 'free', ?, 0, 0, ?, 'free', ?, ?)
    on conflict(user_id) do update set
      account_type = excluded.account_type,
      export_enabled = case
        when account_access.export_enabled = 'full' then 'full'
        else excluded.export_enabled
      end,
      updated_at = excluded.updated_at
  `, userId, accountType, exportEnabled, now, now);
}

async function fetchMe(env, user) {
  await ensureAccountRows(env, user);
  const [appUser, individualProfile, agencyProfile, accountAccess] = await Promise.all([
    dbFirst(env, "select * from users where id = ?", user.id),
    dbFirst(env, "select * from user_profiles where user_id = ?", user.id),
    dbFirst(env, "select * from agency_profiles where user_id = ?", user.id),
    dbFirst(env, "select * from account_access where user_id = ?", user.id)
  ]);

  return {
    auth_user: {
      id: user.id,
      email: user.email || null,
      full_name: user.full_name || null
    },
    user: normalizeUserRow(appUser),
    individual_profile: normalizeIndividualProfile(individualProfile),
    agency_profile: normalizeAgencyProfile(agencyProfile),
    account_access: normalizeAccessRow(accountAccess)
  };
}

async function recordActivity(env, userId, eventType, entityType = null, entityId = null, metadata = {}) {
  await dbRun(env, `
    insert into user_activity (id, user_id, event_type, entity_type, entity_id, metadata, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `, crypto.randomUUID(), userId, eventType, entityType, entityId, jsonText(metadataObject(metadata)), new Date().toISOString());
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
  return errorResponse(410, "clerk_auth_required");
}

async function handleLogin(request, env) {
  return errorResponse(410, "clerk_auth_required");
}

async function handleGoogleLogin(request, env) {
  const url = new URL(env.CLERK_SIGN_IN_URL || "/", request.url);
  const next = safeRedirectPath(new URL(request.url).searchParams.get("next") || "/");
  url.searchParams.set("redirect_url", `${new URL(request.url).origin}${next}`);
  return redirectResponse(url.toString(), 303);
}

async function handleAuthCallback(request, env) {
  return fetchAsset(request, env);
}

async function handleAuthSession(request, env) {
  return errorResponse(410, "clerk_auth_required");
}

async function handleLogout(request, env) {
  return jsonResponse({ ok: true });
}

async function handleMe(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  await ensureAccountRows(env, auth.user);
  await dbRun(env, "update users set last_login_at = ?, email = ?, updated_at = ? where id = ?",
    new Date().toISOString(), auth.user.email || "", new Date().toISOString(), auth.user.id);
  return jsonResponse(await fetchMe(env, auth.user));
}

async function handleAccountType(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  const accountType = cleanString(payload?.account_type);
  if (!ACCOUNT_TYPES.has(accountType)) {
    return errorResponse(400, "account_type must be individual or agency");
  }

  await ensureAccountRows(env, auth.user, accountType);
  await dbRun(env,
    "update users set account_type = ?, onboarding_completed = 0, updated_at = ? where id = ?",
    accountType,
    new Date().toISOString(),
    auth.user.id
  );
  await syncAccountAccessType(env, auth.user.id, accountType);

  await recordActivity(env, auth.user.id, "onboarding_account_type", "account", auth.user.id, { account_type: accountType });
  return jsonResponse(await fetchMe(env, auth.user));
}

async function handleIndividualProfile(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const validated = validateIndividualProfile(payload);
  if (validated.error) return errorResponse(400, validated.error);

  const profile = validated.profile;
  const now = new Date().toISOString();
  await dbRun(env, `
    insert into user_profiles (
      user_id, full_name, current_title, years_experience, target_role_families,
      target_seniority, target_countries, visa_needed, preferred_work_mode,
      salary_min_usd, linkedin_url, resume_url, created_at, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(user_id) do update set
      full_name = excluded.full_name,
      current_title = excluded.current_title,
      years_experience = excluded.years_experience,
      target_role_families = excluded.target_role_families,
      target_seniority = excluded.target_seniority,
      target_countries = excluded.target_countries,
      visa_needed = excluded.visa_needed,
      preferred_work_mode = excluded.preferred_work_mode,
      salary_min_usd = excluded.salary_min_usd,
      linkedin_url = excluded.linkedin_url,
      resume_url = excluded.resume_url,
      updated_at = excluded.updated_at
  `,
    auth.user.id,
    profile.full_name,
    profile.current_title,
    profile.years_experience,
    jsonText(profile.target_role_families),
    profile.target_seniority,
    jsonText(profile.target_countries),
    profile.visa_needed ? 1 : 0,
    profile.preferred_work_mode,
    profile.salary_min_usd,
    profile.linkedin_url,
    profile.resume_url,
    now,
    now
  );

  await recordActivity(env, auth.user.id, "onboarding_individual_profile");
  return jsonResponse(await fetchMe(env, auth.user));
}

async function handleAgencyProfile(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const validated = validateAgencyProfile(payload);
  if (validated.error) return errorResponse(400, validated.error);

  const profile = validated.profile;
  const now = new Date().toISOString();
  await dbRun(env, `
    insert into agency_profiles (
      user_id, agency_name, agency_type, target_markets, target_role_families,
      target_countries, use_case, integration_interest, monthly_data_volume,
      created_at, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(user_id) do update set
      agency_name = excluded.agency_name,
      agency_type = excluded.agency_type,
      target_markets = excluded.target_markets,
      target_role_families = excluded.target_role_families,
      target_countries = excluded.target_countries,
      use_case = excluded.use_case,
      integration_interest = excluded.integration_interest,
      monthly_data_volume = excluded.monthly_data_volume,
      updated_at = excluded.updated_at
  `,
    auth.user.id,
    profile.agency_name,
    profile.agency_type,
    jsonText(profile.target_markets),
    jsonText(profile.target_role_families),
    jsonText(profile.target_countries),
    profile.use_case,
    profile.integration_interest,
    profile.monthly_data_volume,
    now,
    now
  );

  await recordActivity(env, auth.user.id, "onboarding_agency_profile");
  return jsonResponse(await fetchMe(env, auth.user));
}

async function handleCompleteOnboarding(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const me = await fetchMe(env, auth.user);
  const accountType = me.user?.account_type;
  if (!ACCOUNT_TYPES.has(accountType)) {
    return errorResponse(400, "account_type is required");
  }
  if (accountType === "individual" && !me.individual_profile) {
    return errorResponse(400, "individual profile is required");
  }
  if (accountType === "agency" && !me.agency_profile) {
    return errorResponse(400, "agency profile is required");
  }

  await dbRun(env,
    "update users set onboarding_completed = 1, updated_at = ? where id = ?",
    new Date().toISOString(),
    auth.user.id
  );

  await recordActivity(env, auth.user.id, "onboarding_complete", "account", auth.user.id, { account_type: accountType });
  return jsonResponse(await fetchMe(env, auth.user));
}

async function handleSettings(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const brandTheme = cleanString(payload.brand_theme);
  if (!BRAND_THEMES.has(brandTheme)) {
    return errorResponse(400, "brand_theme must be cobalt, graphite, or aurora");
  }

  await dbRun(env,
    "update users set brand_theme = ?, updated_at = ? where id = ?",
    brandTheme,
    new Date().toISOString(),
    auth.user.id
  );

  await recordActivity(env, auth.user.id, "settings_updated", "account", auth.user.id, { brand_theme: brandTheme });
  return jsonResponse(await fetchMe(env, auth.user));
}

async function handleAgencyFeedback(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) return errorResponse(400, "message is required");
  if (message.length > 2000) return errorResponse(400, "message must be 2000 characters or fewer");

  const me = await fetchMe(env, auth.user);
  if (me.user?.account_type !== "agency" || !me.user?.onboarding_completed || !me.agency_profile) {
    return errorResponse(403, "agency onboarding is required");
  }

  const metadata = {
    agency_type: me.agency_profile.agency_type || null,
    use_case: me.agency_profile.use_case || null,
    integration_interest: me.agency_profile.integration_interest || null,
    monthly_data_volume: me.agency_profile.monthly_data_volume || null
  };

  await dbRun(env, `
    insert into agency_feedback (id, user_id, agency_name, message, metadata, created_at)
    values (?, ?, ?, ?, ?, ?)
  `,
    crypto.randomUUID(),
    auth.user.id,
    me.agency_profile.agency_name || null,
    message,
    jsonText(metadata),
    new Date().toISOString()
  );

  await recordActivity(env, auth.user.id, "agency_feedback_submitted", "agency_feedback", auth.user.id, metadata);
  return jsonResponse({ ok: true }, { status: 201 });
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

function jobsPayloadIsStale(data) {
  return data.last_scan !== todayUTC();
}

async function persistSuccessfulScan(env, result, scanDate = null) {
  if (result?.next && env.DB) {
    await persistScanToD1(env, result.next, scanDate || result.next.last_scan);
  }
}

async function maybeRefreshStaleJobs(env, ctx, data) {
  if (!ctx?.waitUntil || !env.KV || !jobsPayloadIsStale(data)) return;

  try {
    const existingLock = await env.KV.get(STALE_SCAN_LOCK_KEY);
    if (existingLock) return;

    await env.KV.put(STALE_SCAN_LOCK_KEY, new Date().toISOString(), {
      expirationTtl: STALE_SCAN_LOCK_TTL_SECONDS
    });
  } catch (error) {
    console.error("stale_scan_lock_failed", error);
    return;
  }

  ctx.waitUntil(
    runScan(env)
      .then(result => persistSuccessfulScan(env, result))
      .catch(error => {
        console.error("stale_scan_failed", error);
      })
  );
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

async function handlePublicJobs(request, env, ctx) {
  const url = new URL(request.url);
  const requestedIndustry = url.searchParams.get("industry") || INDUSTRIES.TECH;
  const industry = Object.values(INDUSTRIES).includes(requestedIndustry) ? requestedIndustry : INDUSTRIES.TECH;
  const data = await readJobsPayload(env);
  await maybeRefreshStaleJobs(env, ctx, data);
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
    clerk_publishable_key: env.CLERK_PUBLISHABLE_KEY || "",
    clerk_sign_in_url: env.CLERK_SIGN_IN_URL || "",
    clerk_sign_up_url: env.CLERK_SIGN_UP_URL || ""
  }, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

async function handleJobsQuery(request, env, ctx) {
  if (isLowBotScore(request)) return errorResponse(403, "bot_check_failed");

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const query = normalizeJobQuery(payload);

  if (query.page > 1) {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
  }

  const data = await readJobsPayload(env);
  await maybeRefreshStaleJobs(env, ctx, data);
  return jsonResponse(pagePostings(data, query));
}

async function handleGetUserJobs(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const rows = await dbAll(env, "select * from user_jobs where user_id = ? order by updated_at desc", auth.user.id);
  return jsonResponse({ jobs: rows.map(normalizeUserJob) });
}

async function handlePutUserJob(request, env, jobId) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const normalizedJobId = cleanString(jobId, 300);
  if (!normalizedJobId) return errorResponse(400, "job_id is required");

  await ensureAccountRows(env, auth.user);
  const existing = normalizeUserJob(await dbFirst(
    env,
    "select * from user_jobs where user_id = ? and job_id = ?",
    auth.user.id,
    normalizedJobId
  ));

  const status = payload.status == null ? existing?.status || "Not started" : cleanString(payload.status);
  if (!STATUSES.has(status)) return errorResponse(400, "invalid status");

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

  await dbRun(env, `
    insert into user_jobs (
      id, user_id, job_id, status, starred, notes, applied_at, saved_at,
      archived_at, viewed_at, created_at, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(user_id, job_id) do update set
      status = excluded.status,
      starred = excluded.starred,
      notes = excluded.notes,
      applied_at = excluded.applied_at,
      saved_at = excluded.saved_at,
      archived_at = excluded.archived_at,
      viewed_at = excluded.viewed_at,
      updated_at = excluded.updated_at
  `,
    existing?.id || crypto.randomUUID(),
    row.user_id,
    row.job_id,
    row.status,
    row.starred ? 1 : 0,
    row.notes,
    row.applied_at,
    row.saved_at,
    row.archived_at,
    row.viewed_at,
    existing?.created_at || now,
    now
  );

  if (payload.viewed === true && !existing?.viewed_at) {
    await insertJobHistory(env, auth.user.id, normalizedJobId, "viewed", null, status);
  }

  if (status !== prevStatus) {
    await insertJobHistory(env, auth.user.id, normalizedJobId, "status_changed", prevStatus, status);
  }

  if (payload.starred != null && Boolean(payload.starred) !== Boolean(existing?.starred)) {
    await insertJobHistory(env, auth.user.id, normalizedJobId, "starred", null, status);
  }

  await recordActivity(env, auth.user.id, "job_state_updated", "job", normalizedJobId, {
    status,
    starred: row.starred
  });
  const saved = normalizeUserJob(await dbFirst(
    env,
    "select * from user_jobs where user_id = ? and job_id = ?",
    auth.user.id,
    normalizedJobId
  ));
  return jsonResponse({ job: saved });
}

async function handleGetUserJobHistory(request, env, jobId) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const normalizedJobId = cleanString(jobId, 300);
  if (!normalizedJobId) return errorResponse(400, "job_id is required");

  const rows = await dbAll(env,
    "select * from user_job_history where user_id = ? and job_id = ? order by created_at desc",
    auth.user.id,
    normalizedJobId
  );
  return jsonResponse({ history: rows });
}

async function handleActivity(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (!payload) return errorResponse(400, "invalid_json");

  const eventType = cleanString(payload.event_type, 120);
  if (!eventType) return errorResponse(400, "event_type is required");

  await recordActivity(
    env,
    auth.user.id,
    eventType,
    cleanString(payload.entity_type, 120) || null,
    cleanString(payload.entity_id, 300) || null,
    metadataObject(payload.metadata)
  );
  return jsonResponse({ ok: true }, { status: 201 });
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
      return handlePublicJobs(request, env, ctx);
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      return handlePublicConfig(env);
    }

    if (url.pathname === "/api/jobs/query" && request.method === "POST") {
      return handleJobsQuery(request, env, ctx);
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
        ctx.waitUntil(persistSuccessfulScan(env, result));
      }
      return jsonResponse({ okCount: result.okCount, failCount: result.failCount, total: result.total });
    }

    return fetchAsset(request, env);
  },

  async scheduled(event, env, ctx) {
    const today = todayUTC();
    const scanPromise = runScan(env).then(result => {
      return persistSuccessfulScan(env, result, today);
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

  await dbRun(env, `
    insert into anonymous_sessions (id, session_token, ip_hash, user_agent_fingerprint, created_at, last_seen_at)
    values (?, ?, null, null, ?, ?)
    on conflict(session_token) do update set last_seen_at = excluded.last_seen_at
  `, crypto.randomUUID(), token, new Date().toISOString(), new Date().toISOString()).catch(() => {});

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

  let userId = null;
  if (hasAuth) {
    try {
      const auth = await requireUser(request, env);
      if (!auth.response) userId = auth.user.id;
    } catch {
      // ignore auth errors, track as anonymous
    }
  }

  const sessionId = cleanString(payload.session_id, 120) || sessionToken || null;

  try {
    if (eventType === "job_view") {
      await dbRun(env, `
        insert into job_views (user_id, session_id, job_id, source, viewed_at)
        values (?, ?, ?, ?, ?)
      `, userId, sessionId, cleanString(payload.job_id, 300) || "", cleanString(payload.source, 80) || "direct", new Date().toISOString());
    } else if (eventType === "search") {
      await dbRun(env, `
        insert into search_queries (user_id, session_id, query_text, filters, result_count, created_at)
        values (?, ?, ?, ?, ?, ?)
      `,
        userId,
        sessionId,
        cleanString(payload.query_text, 500) || null,
        jsonText(metadataObject(payload.filters)),
        Number.isFinite(payload.result_count) ? payload.result_count : null,
        new Date().toISOString()
      );
    } else if (eventType === "page_view") {
      await dbRun(env, `
        insert into page_views (user_id, session_id, page_path, referrer, created_at)
        values (?, ?, ?, ?, ?)
      `, userId, sessionId, cleanString(payload.page_path, 300) || "/", cleanString(payload.referrer, 500) || null, new Date().toISOString());
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

  const url = new URL(request.url);
  const days = clampInteger(url.searchParams.get("days"), 30, 1, 365);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  try {
    const data = await dbAll(env, "select * from daily_scan_stats where scan_date >= ? order by scan_date desc", since);
    return jsonResponse({ stats: data.map(row => ({
      ...row,
      per_source: parseJSONCell(row.per_source, {}),
      per_industry: parseJSONCell(row.per_industry, {}),
      per_niche: parseJSONCell(row.per_niche, {}),
      per_country: parseJSONCell(row.per_country, {}),
      per_family: parseJSONCell(row.per_family, {}),
      per_tier: parseJSONCell(row.per_tier, {})
    })) });
  } catch (err) {
    return errorResponse(500, "internal_error");
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
    const data = await dbAll(env, "select * from search_queries where created_at >= ? order by created_at desc", since);
    return jsonResponse({ searches: data.map(row => ({ ...row, filters: parseJSONCell(row.filters, {}) })) });
  } catch (err) {
    return errorResponse(500, "internal_error");
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
    const data = await dbAll(env, "select * from job_views where viewed_at >= ? order by viewed_at desc", since);
    return jsonResponse({ views: data });
  } catch (err) {
    return errorResponse(500, "internal_error");
  }
}
