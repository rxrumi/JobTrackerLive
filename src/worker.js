import { createClerkClient, verifyToken } from "@clerk/backend";
import { ROLE_FAMILY_NAMES, scoreJob } from "../public/taxonomy.js";
import {
  dispatchDailyResumeMatching,
  deleteUserResumeObjects,
  handleOneClickUnsubscribe,
  handleResumeQueue,
  handleResumeStudioRequest,
  terminateUserResumeWorkflows,
} from "./resume-studio.js";
import { processAccountDeletion } from "./account-lifecycle.js";

// Cloudflare Worker — Job Tracker
// Serves the static HTML and exposes /api/jobs (KV-backed).
// Five cron invocations from 03:00-03:40 UTC scan one bounded source shard each day.
// After the full cycle completes, results are persisted to D1 for trend analysis.

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
const MAX_UPSTREAM_RESPONSE_BYTES = 8 * 1024 * 1024;
const STALE_SCAN_LOCK_KEY_PREFIX = "scan:stale-refresh-lock";
const STALE_SCAN_LOCK_TTL_SECONDS = 2 * 60;
const PARTIAL_SOURCE_STALE_DAYS = 30;
const CUSTOM_SOURCE_LIMIT = 120;
const SCAN_CRONS = ["0 3 * * *", "10 3 * * *", "20 3 * * *", "30 3 * * *", "40 3 * * *"];
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
  snapshotComplete: false,
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
    snapshotComplete: true,
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
  "northern ireland": { country: "GB", city: "Northern Ireland" },
  "scotland": { country: "GB", city: "Scotland" },
  "wales": { country: "GB", city: "Wales" },
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
    patterns: [/\bproduct (manager|owner|lead|strategy|operations|ops|management)\b/, /\bgroup product\b/]
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

export const WORKER_ROLE_FAMILY_NAMES = Object.freeze([
  ...ROLE_FAMILIES.map(group => group.family),
  "Other"
]);

if (JSON.stringify([...WORKER_ROLE_FAMILY_NAMES].sort()) !== JSON.stringify([...ROLE_FAMILY_NAMES].sort())) {
  throw new Error("role_family_taxonomy_mismatch");
}

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
  return matchLocations(locationName)[0] || null;
}

function splitLocationParts(locationName) {
  const raw = String(locationName || "").trim();
  if (!raw) return [];
  const parts = raw
    .replace(/\s+or\s+(?=(?:remote|[A-Z][A-Za-z .'-]+)(?:,|$))/g, " | ")
    .split(/\s*(?:\/|\||;)\s*/)
    .map(part => part.trim())
    .filter(Boolean);
  return [...new Set(parts.length ? parts : [raw])];
}

function matchLocationPart(locationPart) {
  const countryHint = matchCountryHintInLocation(locationPart);
  const alias = matchLocationAlias(locationPart);
  const city = matchCityInLocation(locationPart);
  if (countryHint) {
    return {
      country: countryHint.country,
      city: city?.city || alias?.city || countryHint.city
    };
  }
  return alias || city || null;
}

function matchLocations(locationName) {
  const parts = splitLocationParts(locationName);
  const matches = [];
  const seen = new Set();
  for (const part of parts) {
    const loc = matchLocationPart(part);
    if (!loc) continue;
    const key = `${loc.country}|${normalizeSearchText(loc.city)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ ...loc, location_part: part });
  }
  if (!matches.length && locationName) {
    const loc = matchLocationPart(String(locationName));
    if (loc) matches.push({ ...loc, location_part: String(locationName) });
  }
  return matches;
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
  if (/\b(engineer|engineering|developer)\b/.test(t)) return "Engineering";
  if (/\bdesigner\b/.test(t)) return "Design";
  if (/\b(data scientist|scientist|analytics)\b/.test(t)) return "Data/Analytics";
  if (/\b(accountant|finance)\b/.test(t)) return "Finance";
  if (/\b(counsel|attorney|lawyer)\b/.test(t)) return "Legal/Compliance";
  return ROLE_FALLBACK_KEYWORDS.some(k => matchesNormalizedToken(t, normalizeSearchText(k))) ? "Other" : null;
}

function classifySeniority(title) {
  if (!title) return "Unknown";
  const t = title.toLowerCase();
  if (/\b(chief|cfo|cto|cio|coo|cmo|cro|ceo|vp|vice president)\b/.test(t)) return "Executive";
  if (/\b(director|head of|global head|regional head)\b/.test(t)) return "Director/Head";
  if (/\b(senior|sr\.?|lead|principal|staff)\b/.test(t)) return "Senior/Lead";
  if (/\b(manager|mgr)\b/.test(t)) return "Manager";
  if (/\b(junior|jr\.?|entry[ -]level|graduate|associate|analyst|specialist|coordinator|administrator|consultant)\b/.test(t)) return "Associate/Analyst";
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

function stableTextKey(value) {
  const normalized = normalizeSearchText(value);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
    snapshotComplete: true,
    fetch: s => fetcher(s.token, s.fetchMeta)
  };
}

function customTechSource({ source, token, company, tier = "BigTech", visa, niche = TECH_NICHE, snapshotComplete = false, fetch }) {
  return {
    source,
    token,
    company,
    industry: INDUSTRIES.TECH,
    niche,
    tier,
    visa,
    snapshotComplete,
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
    snapshotComplete: true,
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

function scanSourceShards() {
  const sources = scanSources();
  const standard = sources.filter(source => ["greenhouse", "ashby", "lever"].includes(source.source));
  return [
    standard.slice(0, 23),
    standard.slice(23),
    sources.filter(source => source.source === "smartrecruiters"),
    sources.filter(source => ["amazon", "apple"].includes(source.source)),
    sources.filter(source => ["eightfold", "yc"].includes(source.source) || ![
      "greenhouse", "ashby", "lever", "smartrecruiters", "amazon", "apple"
    ].includes(source.source))
  ];
}

function normalizeShardIndex(value, fallback = 0) {
  return clampInteger(value, fallback, 0, scanSourceShards().length - 1);
}

function scanShardForCron(cron) {
  const index = SCAN_CRONS.indexOf(String(cron || ""));
  return index >= 0 ? index : 0;
}

function nextIncompleteShard(state, today = todayUTC()) {
  const cycle = state?.scan_cycle;
  if (cycle?.date !== today) return 0;
  const completed = new Set(Array.isArray(cycle.completed_shards) ? cycle.completed_shards : []);
  for (let i = 0; i < scanSourceShards().length; i++) {
    if (!completed.has(i)) return i;
  }
  return 0;
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
    for (let index = 0; index < statements.length; index += 50) {
      await database.batch(statements.slice(index, index + 50));
    }
    return;
  }
  for (const statement of statements) await statement.run();
}

const RESUME_STUDIO_DEPS = {
  run: dbRun,
  first: dbFirst,
  all: dbAll,
  batch: dbBatch
};

async function persistScanToD1(env, scanResult, today, scanRunId = null) {
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
        role_family, seniority, visa, score, tier, is_new, is_filled, created_at, scan_run_id
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        is_filled = excluded.is_filled,
        scan_run_id = excluded.scan_run_id
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
      now,
      scanRunId
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
  const freshness = lastFilled ? 30 : daysBetween(firstSeen, today) <= 7 ? 100 : 80;
  return scoreJob({ visa, seniority, freshness });
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
    ...(failure.status ? { status: failure.status } : {}),
    ...(failure.message ? { message: cleanString(failure.message, 300) } : {})
  });
}

async function fetchWithTimeout(url, init = {}, diagnostics = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = new URL(url);
    let r;
    for (let redirect = 0; redirect <= 5; redirect++) {
      const hostname = current.hostname.toLowerCase();
      const approved = current.protocol === "https:"
        && !current.username && !current.password && !current.port
        && !hostname.includes(":")
        && !/^(?:localhost|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname)
        && (new Set([
          "boards-api.greenhouse.io", "api.ashbyhq.com", "api.lever.co", "api.smartrecruiters.com",
          "www.amazon.jobs", "jobs.apple.com", "explore.jobs.netflix.net", "www.ycombinator.com", "yc-oss.github.io"
        ]).has(hostname) || hostname.endsWith(".myworkdayjobs.com"));
      if (!approved) {
        recordFetchFailure(diagnostics, { url: current, reason: "unapproved_hostname" });
        return null;
      }
      r = await fetch(current.toString(), { cf: { cacheTtl: 0 }, ...init, redirect: "manual", signal: controller.signal });
      if (![301, 302, 303, 307, 308].includes(r.status)) break;
      const location = r.headers.get("location");
      if (!location || redirect === 5) {
        recordFetchFailure(diagnostics, { url: current, reason: "redirect_limit" });
        return null;
      }
      current = new URL(location, current);
    }
    if (!r.ok) {
      recordFetchFailure(diagnostics, { url, reason: "http_error", status: r.status });
      return null;
    }
    return r;
  } catch (error) {
    recordFetchFailure(diagnostics, {
      url,
      reason: error?.name === "AbortError" ? "timeout" : "fetch_error",
      message: error instanceof Error ? error.message : String(error || "")
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
    const text = await readBoundedResponseText(r);
    if (text == null) throw new Error("response_too_large");
    return JSON.parse(text);
  } catch {
    recordFetchFailure(diagnostics, { url, reason: "invalid_json" });
    return null;
  }
}

async function fetchText(url, diagnostics = null) {
  const r = await fetchWithTimeout(url, {}, diagnostics);
  if (!r) return null;
  try {
    return await readBoundedResponseText(r);
  } catch {
    recordFetchFailure(diagnostics, { url, reason: "invalid_text" });
    return null;
  }
}

async function readBoundedResponseText(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_UPSTREAM_RESPONSE_BYTES) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPSTREAM_RESPONSE_BYTES) {
      await reader.cancel("response_too_large").catch(() => {});
      return null;
    }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
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

function sourceSnapshotIsComplete(source, meta, fetchMeta) {
  if (source.snapshotComplete === false || meta?.snapshotComplete === false) return false;
  if (meta?.truncated) return false;
  if (Array.isArray(meta?.failedPages) && meta.failedPages.length) return false;
  if (Array.isArray(fetchMeta?.failures) && fetchMeta.failures.length) return false;
  return true;
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
      id: i === 0 ? String(j.id) : `${j.id}-loc-${stableTextKey(loc)}`,
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
      truncated: out.length >= CUSTOM_SOURCE_LIMIT,
      snapshotComplete: false
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
      truncated: out.length >= CUSTOM_SOURCE_LIMIT,
      snapshotComplete: false
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
        id: i === 0
          ? String(job.id || job.ats_job_id)
          : `${job.id || job.ats_job_id}-loc-${stableTextKey(loc)}`,
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
      truncated: out.length >= CUSTOM_SOURCE_LIMIT,
      snapshotComplete: out.length < CUSTOM_SOURCE_LIMIT
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
      id: i === 0 ? String(j.id) : `${j.id}-loc-${stableTextKey(loc)}`,
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
  let totalFound = null;
  let pagesFetched = 0;
  for (let page = 0; page < 10; page++) {
    const url = `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100&offset=${offset}`;
    const data = await fetchJSON(url, {}, diagnostics);
    if (!data) {
      if (page === 0) return null;
      return {
        jobs: out,
        meta: { pagesFetched, totalFound, fetchedCount: out.length, snapshotComplete: false, failedPages: [page] }
      };
    }
    pagesFetched++;
    totalFound = Number.isFinite(Number(data.totalFound)) ? Number(data.totalFound) : totalFound;
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
    if (content.length < 100 || offset >= (data.totalFound || 0)) {
      return {
        jobs: out,
        meta: { pagesFetched, totalFound, fetchedCount: out.length, snapshotComplete: true }
      };
    }
  }
  return {
    jobs: out,
    meta: {
      pagesFetched,
      totalFound,
      fetchedCount: out.length,
      snapshotComplete: totalFound != null && offset >= totalFound,
      truncated: totalFound == null || offset < totalFound
    }
  };
}

export async function runScan(env, options = {}) {
  const today = todayUTC();
  const now = new Date().toISOString();
  const prev = (await env.KV.get("state", "json")) || { postings: {} };
  prev.postings ||= {};

  const allSources = scanSources();
  const shards = scanSourceShards();
  const sharded = options.shardIndex !== undefined && options.shardIndex !== null;
  const shardIndex = sharded ? normalizeShardIndex(options.shardIndex) : null;
  const sources = sharded ? shards[shardIndex] : allSources;
  const scannedSourceIds = new Set(sources.map(sourceId));
  const found = {};
  const failedSources = new Set();
  const partialSources = new Set();
  const okSources = new Set();
  const sourceMeta = {};
  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < sources.length; i += 8) {
    const batch = sources.slice(i, i + 8);
    const results = await Promise.allSettled(batch.map(async s => {
      const sourceForFetch = { ...s, fetchMeta: { failures: [] } };
      try {
        const result = normalizeFetchResult(await sourceForFetch.fetch(sourceForFetch));
        return { s, fetchMeta: sourceForFetch.fetchMeta, ...result };
      } catch (error) {
        recordFetchFailure(sourceForFetch.fetchMeta, {
          reason: "source_exception",
          message: error instanceof Error ? error.message : String(error || "")
        });
        return { s, fetchMeta: sourceForFetch.fetchMeta, jobs: null };
      }
    }));

    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value.jobs) {
        failCount++;
        const failed = r.status === "fulfilled" ? r.value.s : null;
        if (failed) {
          const sid = sourceId(failed);
          failedSources.add(sid);
          sourceMeta[sid] = {
            status: "failed",
            ...(sourceDiagnosticsMeta(r.value.fetchMeta) || {})
          };
        }
        continue;
      }

      okCount++;
      const { s, jobs, meta, fetchMeta } = r.value;
      const sid = sourceId(s);
      const snapshotComplete = sourceSnapshotIsComplete(s, meta, fetchMeta);
      okSources.add(sid);
      if (!snapshotComplete) partialSources.add(sid);

      let retainedJobs = 0;
      let rejectedLocation = 0;
      let rejectedRole = 0;
      for (const job of jobs) {
        const locations = matchLocations(job.location);
        if (!locations.length) {
          rejectedLocation++;
          continue;
        }
        const roleFamily = job.role_family || classifyRoleFamily(job.title);
        if (!roleFamily) {
          rejectedRole++;
          continue;
        }

        const baseId = `${s.source}-${s.token}-${job.id}`;
        for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
          const loc = locations[locationIndex];
          const id = locationIndex === 0
            ? baseId
            : `${baseId}-loc-${loc.country.toLowerCase()}-${stableTextKey(loc.location_part)}`;
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
            location: loc.location_part || job.location,
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
          retainedJobs++;
        }
      }

      sourceMeta[sid] = {
        ...(meta || {}),
        ...(sourceDiagnosticsMeta(fetchMeta) || {}),
        status: snapshotComplete ? "complete" : "partial",
        fetchedJobs: jobs.length,
        retainedJobs,
        rejectedLocation,
        rejectedRole
      };
    }
  }

  if (okCount === 0) {
    return {
      error: "all_fetch_failed",
      shardIndex,
      okCount,
      failCount,
      failedSources: [...failedSources]
    };
  }

  const scannedBoards = sources.length;
  if (failCount === scannedBoards || (scannedBoards >= 3 && failCount / scannedBoards > FAILURE_ABORT_RATIO)) {
    return {
      error: "too_many_fetch_failures",
      shardIndex,
      okCount,
      failCount,
      scannedBoards,
      failedSources: [...failedSources]
    };
  }

  // Re-read state after network work so overlapping shards merge the newest
  // completion markers and postings instead of overwriting each other.
  const latest = (await env.KV.get("state", "json")) || prev;
  latest.postings ||= {};
  const merged = {};
  for (const [id, p] of Object.entries(latest.postings)) {
    if (found[id]) continue;
    if (!ACTIVE_SOURCES.has(p.source)) continue;
    const sid = postingSourceId(p);
    if (!scannedSourceIds.has(sid) || failedSources.has(sid)) {
      merged[id] = normalizePosting(p, today);
      continue;
    }
    if (partialSources.has(sid) && daysBetween(p.last_seen || p.first_seen || today, today) <= PARTIAL_SOURCE_STALE_DAYS) {
      merged[id] = normalizePosting(p, today);
      continue;
    }
    const filledDate = p.last_filled || today;
    if (daysBetween(filledDate, today) <= 7) {
      merged[id] = normalizePosting({ ...p, last_filled: filledDate }, today);
    }
  }
  Object.assign(merged, found);

  const previousCycleIsCurrent = latest.scan_cycle?.date === today;
  const completedShards = new Set(previousCycleIsCurrent ? latest.scan_cycle.completed_shards || [] : []);
  if (sharded) completedShards.add(shardIndex);
  else shards.forEach((_, index) => completedShards.add(index));
  const cycleComplete = completedShards.size === shards.length;

  const previousMeta = previousCycleIsCurrent ? latest.scan_meta || {} : {};
  const aggregateOkSources = new Set(previousMeta.okSources || []);
  const aggregateFailedSources = new Set(previousMeta.failedSources || []);
  const aggregatePartialSources = new Set(previousMeta.partialSources || []);
  for (const sid of scannedSourceIds) {
    aggregateOkSources.delete(sid);
    aggregateFailedSources.delete(sid);
    aggregatePartialSources.delete(sid);
  }
  okSources.forEach(sid => aggregateOkSources.add(sid));
  failedSources.forEach(sid => aggregateFailedSources.add(sid));
  partialSources.forEach(sid => aggregatePartialSources.add(sid));

  const next = {
    last_scan: cycleComplete ? today : latest.last_scan || null,
    last_scan_at: cycleComplete ? now : latest.last_scan_at || null,
    last_partial_scan_at: now,
    scan_cycle: {
      date: today,
      completed_shards: [...completedShards].sort((a, b) => a - b),
      total_shards: shards.length,
      complete: cycleComplete
    },
    postings: merged,
    scan_meta: {
      okCount: aggregateOkSources.size,
      failCount: aggregateFailedSources.size,
      partialCount: aggregatePartialSources.size,
      totalBoards: allSources.length,
      scannedBoards,
      lastShard: shardIndex,
      okSources: [...aggregateOkSources],
      failedSources: [...aggregateFailedSources],
      partialSources: [...aggregatePartialSources],
      sourceMeta: { ...(previousMeta.sourceMeta || {}), ...sourceMeta }
    }
  };

  await env.KV.put("state", JSON.stringify(next));
  await env.KV.put("jobs", JSON.stringify({
    last_scan: next.last_scan,
    last_scan_at: next.last_scan_at,
    last_partial_scan_at: next.last_partial_scan_at,
    scan_cycle: next.scan_cycle,
    scan_meta: next.scan_meta,
    postings: Object.values(merged)
  }));

  return {
    shardIndex,
    cycleComplete,
    completedShards: next.scan_cycle.completed_shards,
    okCount,
    failCount,
    partialCount: partialSources.size,
    total: Object.keys(merged).length,
    next
  };
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
    appHref: "/app/jobs",
    schemaType: "CollectionPage"
  },
  "/visa-roles": {
    title: "Visa-Aware Tech Roles with Strong Hiring Signals",
    description: "Find global tech openings at companies with strong visa support signals. Review active roles by location, seniority, and company tier.",
    heading: "Visa-Aware Roles",
    eyebrow: "Sponsorship signals",
    intro: "Focus your search on companies with strong or likely sponsorship history while keeping the current signal heuristic clear.",
    cta: "View Visa-Aware Roles",
    appHref: "/app/visa-roles",
    schemaType: "CollectionPage"
  },
  "/pipeline": {
    title: "My Pipeline: Save Targets and Track Applications",
    description: "Save job targets, organize application status, and manage your search pipeline inside Live Job Index.",
    heading: "My Pipeline",
    eyebrow: "Application tracking",
    intro: "Keep saved targets, application status, notes, and account preferences together once you sign in.",
    cta: "Sign In to Track Pipeline",
    appHref: "/app/pipeline",
    schemaType: "WebPage"
  },
  "/insights": {
    title: "Market Insights for Global Tech Hiring",
    description: "Track lightweight hiring trends across leading markets, top tech companies, role families, and visa-aware opportunity signals.",
    heading: "Market Insights",
    eyebrow: "Hiring trends",
    intro: "Review lightweight trends from the current job feed, including strongest markets, role families, and visa-aware hiring signals.",
    cta: "Explore Hiring Trends",
    appHref: "/app/insights",
    schemaType: "CollectionPage"
  }
};

const ANON_SESSION_COOKIE = "lji_session";
const ANON_SESSION_TTL_DAYS = 365;
const TRACKABLE_EVENTS = new Set(["job_view", "search", "page_view"]);
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_TRACKING_BODY_BYTES = 32 * 1024;
const SAFE_SERVER_ERRORS = new Set(["account_setup_failed", "analytics unavailable", "account_deletion_provider_failed"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function contentSecurityPolicy(nonce = "") {
  const inlineScriptSources = [
    "'sha256-ldkzr2CsTnpA+uKoOmgTy6Jh/kWXTzLF8D3PRDBeTtM='",
    ...(nonce ? [`'nonce-${nonce}'`] : [])
  ].join(" ");
  return [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests",
  `script-src 'self' ${inlineScriptSources} https://cdn.jsdelivr.net https://*.clerk.accounts.dev https://*.clerk.com https://clerk.livejobindex.com https://accounts.livejobindex.com https://www.googletagmanager.com https://www.google-analytics.com https://www.clarity.ms`,
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.livejobindex.com https://accounts.livejobindex.com https://api.clerk.com https://img.clerk.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.clarity.ms https://cloudflareinsights.com",
  "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.livejobindex.com https://accounts.livejobindex.com",
  "img-src 'self' data: https: https://img.clerk.com",
  "style-src 'self'",
  "worker-src 'self' blob:"
  ].join("; ");
}

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return withTrustHeaders(new Response(JSON.stringify(data), { ...init, headers }));
}

function errorResponse(status, message, details = null) {
  const safeMessage = status >= 500 && !SAFE_SERVER_ERRORS.has(message) ? "internal_error" : message;
  const requestId = crypto.randomUUID();
  return jsonResponse({
    error: {
      code: String(safeMessage).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
      message: safeMessage,
      request_id: requestId,
      ...(details ? { details } : {})
    }
  }, { status, headers: { "X-Request-ID": requestId } });
}

function methodNotAllowed(allow) {
  const response = errorResponse(405, "method_not_allowed");
  const headers = new Headers(response.headers);
  headers.set("Allow", allow.join(", "));
  return withTrustHeaders(new Response(response.body, { status: 405, headers }));
}

function allowedApiMethods(pathname) {
  const exact = new Map([
    ["/api/jobs", ["GET"]], ["/api/jobs/query", ["POST"]], ["/api/status", ["GET"]],
    ["/api/admin/health", ["GET"]], ["/api/config", ["GET"]], ["/api/me", ["GET", "DELETE"]],
    ["/api/me/export", ["POST"]], ["/api/privacy/consent", ["GET", "POST"]],
    ["/api/saved-searches", ["GET", "POST"]], ["/api/alert-preferences", ["GET", "PATCH"]],
    ["/api/user-jobs", ["GET"]],
    ["/api/activity", ["POST"]], ["/api/session", ["POST"]], ["/api/track", ["POST"]],
    ["/api/settings", ["PATCH"]], ["/api/logout", ["POST"]], ["/api/auth/session", ["POST"]],
    ["/api/agency-feedback", ["POST"]], ["/api/webhooks/clerk", ["POST"]], ["/api/scan-now", ["POST"]],
    ["/api/onboarding/account-type", ["PATCH"]], ["/api/onboarding/individual-profile", ["PATCH"]],
    ["/api/onboarding/agency-profile", ["PATCH"]], ["/api/onboarding/complete", ["POST"]],
    ["/api/analytics/jobs", ["GET"]], ["/api/analytics/searches", ["GET"]], ["/api/analytics/views", ["GET"]]
  ]);
  if (exact.has(pathname)) return exact.get(pathname);
  if (/^\/api\/saved-searches\/[^/]+$/.test(pathname)) return ["PATCH", "DELETE"];
  if (/^\/api\/me\/export\/[^/]+(?:\/download)?$/.test(pathname)) return ["GET"];
  if (/^\/api\/me\/deletion\/[^/]+$/.test(pathname)) return ["GET"];
  if (/^\/api\/user-jobs\/[^/]+\/history$/.test(pathname)) return ["GET"];
  if (/^\/api\/user-jobs\/[^/]+$/.test(pathname)) return ["PUT"];
  return null;
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

function slugify(value) {
  return String(value || "job").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "job";
}

function safeApplyUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : SITE_ORIGIN;
  } catch {
    return SITE_ORIGIN;
  }
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
    activeOnly: payload.active_only === true || filters.lifecycle === "active",
    starredIds: null,
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

function postingMatchesQuery(posting, query, options = {}) {
  if (query.activeOnly && posting.last_filled) return false;
  if (query.ids.length && !query.ids.includes(posting.id)) return false;
  const filters = query.filters;
  const industry = posting.industry || INDUSTRIES.TECH;
  const niche = posting.niche || (industry === INDUSTRIES.ENGINEERING ? "Engineering" : TECH_NICHE);
  if (filters.industry.length && !filters.industry.includes(industry)) return false;
  if (filters.niche.length && !filters.niche.includes(niche)) return false;
  if (!options.ignoreCountry && filters.country.length && !filters.country.includes(posting.country)) return false;
  const tier = normalizeTier(posting.tier);
  if (filters.tier.length && !filters.tier.includes(tier)) return false;
  if (filters.family.length && !filters.family.includes(posting.role_family)) return false;
  if (filters.seniority.length && !filters.seniority.includes(posting.seniority)) return false;
  if (filters.visa.length && !filters.visa.includes(posting.visa)) return false;
  if (filters.presets.includes("senior") && !["Senior/Lead", "Manager", "Director/Head", "Executive"].includes(posting.seniority)) return false;
  if (filters.presets.includes("strong-visa") && posting.visa !== "Strong") return false;
  if (filters.presets.includes("new") && !postingIsNew(posting)) return false;
  if (filters.presets.includes("starred") && !query.starredIds?.has(String(posting.id))) return false;
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
  const countryMatches = all.filter(posting => postingMatchesQuery(posting, query, { ignoreCountry: true }));
  const country = {};
  for (const posting of countryMatches) {
    if (posting.country) country[posting.country] = (country[posting.country] || 0) + 1;
  }
  const total = matching.length;
  const totalPages = Math.max(1, Math.ceil(total / query.per_page));
  const page = Math.min(query.page, totalPages);
  const start = (page - 1) * query.per_page;
  return {
    last_scan: data.last_scan || null,
    last_scan_at: data.last_scan_at || null,
    scan_meta: data.scan_meta || null,
    scan_cycle: data.scan_cycle || null,
    facets: { country },
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

function encodeJobCursor(page, query) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    page,
    per_page: query.per_page,
    sort: query.sort,
    dir: query.dir
  })));
}

function decodeJobCursor(value) {
  if (!value) return null;
  try {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 ? "=".repeat(4 - normalized.length % 4) : "";
    const bytes = Uint8Array.from(atob(normalized + padding), character => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return { page: clampInteger(parsed.page, 1, 1, 10000) };
  } catch {
    return null;
  }
}

function cursorJobResponse(pageResult, data, query, authenticated = false) {
  const nextCursor = pageResult.pagination.has_next
    ? encodeJobCursor(pageResult.pagination.page + 1, query)
    : null;
  return {
    ...pageResult,
    items: pageResult.postings,
    next_cursor: nextCursor,
    has_more: pageResult.pagination.has_next,
    feed_version: data.feed_version || data.last_scan_at || data.last_scan || null,
    generated_at: data.last_scan_at || null,
    gate: {
      authentication_required_after_first_page: true,
      authenticated,
      sign_in_url: authenticated ? null : "/api/login?next=/app/jobs"
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
  if (!origin) {
    const pathname = new URL(request.url).pathname;
    // Browsers advertise Fetch Metadata on scripted/form mutations. Require an
    // Origin for those requests, while keeping signed server-to-server and CLI
    // integrations usable (curl and webhooks do not necessarily send Origin).
    const browserMutation = Boolean(
      request.headers.get("Sec-Fetch-Site")
      || request.headers.get("Sec-Fetch-Mode")
      || request.headers.get("Sec-Fetch-Dest")
    );
    return Boolean(
      !browserMutation
      ||
      env.ALLOW_MISSING_ORIGIN === "true"
      || env.CLERK_USER
      || request.headers.get("X-Scan-Key")
      || request.headers.get("svix-signature")
      || pathname === "/api/email/unsubscribe"
    );
  }
  return allowedOrigins(request, env).has(origin);
}

function requireSameOrigin(request, env) {
  return hasValidOrigin(request, env) ? null : errorResponse(403, "invalid_origin");
}

async function enforceRateLimit(request, env, { scope, limit, windowSeconds, cost = 1 }) {
  if (!env.RATE_LIMITER?.getByName) return null;
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const authSubject = authTokenFromRequest(request);
  const key = await sha256Base64Url(`${scope}:${authSubject || ip}`);
  const shard = env.RATE_LIMITER.getByName(key.slice(0, 2));
  const response = await shard.fetch("https://rate-limit.internal/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, limit, window_seconds: windowSeconds, cost })
  });
  if (response.ok) return null;
  const result = await response.json().catch(() => ({}));
  return jsonResponse({
    error: "rate_limit_exceeded",
    retry_after: result.retry_after || windowSeconds
  }, {
    status: 429,
    headers: { "Retry-After": String(result.retry_after || windowSeconds) }
  });
}

function safeRedirectPath(value) {
  const path = cleanString(value || "/", 300);
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

const APP_SHELL_ASSET_VERSION = "20260722-3";

function assetRequest(request, pathname, search = "") {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = search;
  return new Request(url.toString(), request);
}

const TRUST_HEADERS = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Content-Security-Policy": contentSecurityPolicy()
};

function withTrustHeaders(response, nonce = "") {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(TRUST_HEADERS)) {
    headers.set(key, value);
  }
  if (nonce) headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function fetchAsset(request, env, pathname) {
  const assetPath = pathname || new URL(request.url).pathname;
  const isAppShell = /\.html?$/.test(assetPath) || !/\.[a-z0-9]+$/i.test(assetPath);
  const assetFetchRequest = pathname
    ? assetRequest(request, pathname, isAppShell ? `?v=${APP_SHELL_ASSET_VERSION}` : "")
    : isAppShell
      ? assetRequest(request, assetPath, `?v=${APP_SHELL_ASSET_VERSION}`)
      : request;
  const response = await env.ASSETS.fetch(assetFetchRequest);
  const headers = new Headers(response.headers);
  if (isAppShell) {
    headers.set("Cache-Control", "no-cache, must-revalidate");
  } else if (/\.(?:avif|webp|png|jpe?g|gif|svg|ico|woff2?)$/i.test(assetPath)) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  }
  return withTrustHeaders(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
}

const BODY_TOO_LARGE = Symbol("body_too_large");

async function readJSON(request, maxBytes = MAX_JSON_BODY_BYTES) {
  try {
    const length = Number(request.headers.get("Content-Length") || "0");
    if (Number.isFinite(length) && length > maxBytes) return BODY_TOO_LARGE;
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) return BODY_TOO_LARGE;
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

function clerkUserEmailVerified(clerkUser) {
  if (typeof clerkUser?.email_verified === "boolean") return clerkUser.email_verified;
  const primaryId = clerkUser?.primaryEmailAddressId || clerkUser?.primary_email_address_id;
  const emails = clerkUser?.emailAddresses || clerkUser?.email_addresses || [];
  const primary = emails.find(email => (email.id || email.emailAddress) === primaryId) || emails[0];
  const status = primary?.verification?.status || primary?.verification_status;
  return status ? status === "verified" : true;
}

async function userLifecycleResponse(env, userId, allowDeletionPending = false) {
  if (!env.DB) return null;
  try {
    const row = await dbFirst(env, "select lifecycle_state from users where id = ?", userId);
    if (row?.lifecycle_state === "deleted") return errorResponse(401, "account_deleted");
    if (row?.lifecycle_state === "deletion_pending" && !allowDeletionPending) {
      return errorResponse(423, "account_deletion_pending");
    }
  } catch {
    // The additive lifecycle migration may not be applied during a rolling deploy.
  }
  return null;
}

async function requireUser(request, env, options = {}) {
  if (env.CLERK_USER) {
    const user = {
      id: env.CLERK_USER.id,
      email: env.CLERK_USER.email || "",
      email_verified: env.CLERK_USER.email_verified !== false,
      full_name: cleanString(env.CLERK_USER.full_name || env.CLERK_USER.name, 180) || null
    };
    const lifecycleResponse = await userLifecycleResponse(env, user.id, options.allowDeletionPending);
    return lifecycleResponse
      ? { response: lifecycleResponse }
      : { context: { iat: Math.floor(Date.now() / 1000) }, user };
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
      email_verified: clerkUserEmailVerified(clerkUser),
      full_name: clerkUserName(clerkUser) || cleanString(claims.name || claims.full_name, 180) || null
    };
    const lifecycleResponse = await userLifecycleResponse(env, user.id, options.allowDeletionPending);
    return lifecycleResponse ? { response: lifecycleResponse } : { context: claims || {}, user };
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
    where users.lifecycle_state not in ('deletion_pending', 'deleted')
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
  const sessionToken = getAnonSessionCookie(request);
  if (sessionToken) {
    await dbRun(env, "update anonymous_sessions set user_id = ?, last_seen_at = ? where session_token = ?",
      auth.user.id, new Date().toISOString(), sessionToken).catch(() => {});
  }
  return jsonResponse(await fetchMe(env, auth.user));
}

async function handleDeleteMe(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const payload = await readJSON(request);
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
  const confirmation = cleanString(payload?.confirmation, 320).toLowerCase();
  if (!["delete my account", cleanString(auth.user.email, 320).toLowerCase()].includes(confirmation)) {
    return errorResponse(400, "account_deletion_confirmation_required");
  }
  const issuedAt = Number(auth.context?.iat || 0) * 1000;
  if (!issuedAt || Date.now() - issuedAt > 10 * 60 * 1000) return errorResponse(401, "recent_authentication_required");
  if (!env.CLERK_USER && !env.CLERK_SECRET_KEY) return errorResponse(503, "account_deletion_provider_failed");
  if (!env.ACCOUNT_WORKFLOW?.create) {
    await terminateUserResumeWorkflows(env, auth.user.id, RESUME_STUDIO_DEPS);
    await deleteUserResumeObjects(env, auth.user.id);
    if (!env.CLERK_USER && env.CLERK_SECRET_KEY) {
      try {
        const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
        await clerk.users.deleteUser(auth.user.id);
      } catch {
        return errorResponse(503, "account_deletion_provider_failed");
      }
    }
    await dbRun(env, "delete from users where id = ?", auth.user.id);
    return jsonResponse({ ok: true, deleted: true });
  }
  const deletionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const userHash = await sha256Base64Url(`deleted-user:${auth.user.id}`);
  await dbBatch(env, [
    env.DB.prepare(`insert into account_deletion_requests
      (id, user_id, user_hash, source, status, current_step, created_at, updated_at)
      values (?, ?, ?, 'user', 'pending', 'requested', ?, ?)`)
      .bind(deletionId, auth.user.id, userHash, now, now),
    env.DB.prepare(`update users set lifecycle_state = 'deletion_pending', deletion_requested_at = ?, updated_at = ? where id = ?`)
      .bind(now, now, auth.user.id)
  ]);
  try {
    await env.ACCOUNT_WORKFLOW.create({ id: deletionId, params: { type: "delete_account", request_id: deletionId } });
  } catch (failure) {
    await dbRun(env, "update account_deletion_requests set status = 'retrying', failure_code = ?, updated_at = ? where id = ?",
      "workflow_start_failed", new Date().toISOString(), deletionId);
    console.error(JSON.stringify({ event: "account_deletion_workflow_start_failed", deletionId, message: failure?.message || String(failure) }));
  }
  return jsonResponse({ deletion_id: deletionId, status: "pending" }, { status: 202 });
}

async function handleDeletionStatus(request, env, deletionId) {
  const auth = await requireUser(request, env, { allowDeletionPending: true });
  if (auth.response) return auth.response;
  const row = await dbFirst(env, `select id, status, current_step, failure_code, created_at, updated_at, completed_at
    from account_deletion_requests where id = ? and user_id = ?`, deletionId, auth.user.id);
  return row ? jsonResponse({ deletion: row }) : errorResponse(404, "deletion_request_not_found");
}

async function handleDataExports(request, env, exportId = null, download = false) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  if (request.method === "POST" && !exportId) {
    if (!env.ACCOUNT_WORKFLOW?.create || !env.RESUME_FILES) return errorResponse(503, "export_unavailable");
    const recent = await dbFirst(env, `select id, status from data_export_requests where user_id = ?
      and created_at >= datetime('now','-1 day') order by created_at desc limit 1`, auth.user.id);
    if (recent && new Set(["pending", "processing", "ready"]).has(recent.status)) {
      return jsonResponse({ export_id: recent.id, status: recent.status }, { status: 202 });
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await dbRun(env, `insert into data_export_requests (id, user_id, status, created_at, updated_at)
      values (?, ?, 'pending', ?, ?)`, id, auth.user.id, now, now);
    await env.ACCOUNT_WORKFLOW.create({ id, params: { type: "export_account", request_id: id } });
    return jsonResponse({ export_id: id, status: "pending" }, { status: 202 });
  }
  if (request.method !== "GET" || !exportId) return errorResponse(405, "method_not_allowed");
  const row = await dbFirst(env, "select * from data_export_requests where id = ? and user_id = ?", exportId, auth.user.id);
  if (!row) return errorResponse(404, "export_not_found");
  if (!download) return jsonResponse({ export: { ...row, r2_key: undefined } });
  if (row.status !== "ready" || !row.r2_key || !row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
    return errorResponse(410, "export_not_available");
  }
  const object = await env.RESUME_FILES.get(row.r2_key);
  if (!object) return errorResponse(404, "export_file_not_found");
  return withTrustHeaders(new Response(object.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="live-job-index-export-${exportId}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  }));
}

async function handleAccountType(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
  const accountType = cleanString(payload?.account_type);
  if (!ACCOUNT_TYPES.has(accountType)) {
    return errorResponse(400, "account_type must be individual or agency");
  }

  await ensureAccountRows(env, auth.user, accountType);
  await dbRun(env,
    "update users set account_type = ?, onboarding_completed = 0, lifecycle_state = 'pending_onboarding', updated_at = ? where id = ?",
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
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
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
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
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
    "update users set onboarding_completed = 1, lifecycle_state = 'active', updated_at = ? where id = ?",
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
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
  if (!payload) return errorResponse(400, "invalid_json");

  const brandTheme = payload.brand_theme == null ? null : cleanString(payload.brand_theme);
  if (brandTheme != null && !BRAND_THEMES.has(brandTheme)) {
    return errorResponse(400, "brand_theme must be cobalt, graphite, or aurora");
  }
  const timezone = payload.timezone == null ? null : cleanString(payload.timezone, 100);
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
    } catch {
      return errorResponse(400, "invalid_timezone");
    }
  }
  if (!brandTheme && !timezone) return errorResponse(400, "settings_update_required");

  await dbRun(env,
    "update users set brand_theme = coalesce(?, brand_theme), timezone = coalesce(?, timezone), updated_at = ? where id = ?",
    brandTheme,
    timezone,
    new Date().toISOString(),
    auth.user.id
  );

  await recordActivity(env, auth.user.id, "settings_updated", "account", auth.user.id, { brand_theme: brandTheme, timezone });
  return jsonResponse(await fetchMe(env, auth.user));
}

const CONSENT_COOKIE = "lji_consent";
const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

function analyticsConsentFromRequest(request) {
  return cookieValue(request, CONSENT_COOKIE) === "analytics"
    && request.headers.get("Sec-GPC") !== "1";
}

async function handlePrivacyConsent(request, env) {
  const sessionToken = getAnonSessionCookie(request);
  let user = null;
  if (hasAuthMaterial(request)) {
    const auth = await requireUser(request, env, { allowDeletionPending: true });
    if (!auth.response) user = auth.user;
  }
  if (request.method === "GET") {
    let analytics = analyticsConsentFromRequest(request);
    if (user) {
      const row = await dbFirst(env, "select analytics_consent from users where id = ?", user.id).catch(() => null);
      if (row) analytics = Boolean(row.analytics_consent) && request.headers.get("Sec-GPC") !== "1";
    }
    return jsonResponse({
      essential: true,
      analytics,
      global_privacy_control: request.headers.get("Sec-GPC") === "1",
      policy_version: env.PRIVACY_POLICY_VERSION || "2026-07-22"
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed");
  const payload = await readJSON(request);
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
  if (!payload || typeof payload.analytics !== "boolean") return errorResponse(400, "analytics_consent_required");
  const gpc = request.headers.get("Sec-GPC") === "1";
  const analytics = gpc ? false : payload.analytics;
  const now = new Date().toISOString();
  let sessionId = null;
  if (sessionToken) {
    const session = await dbFirst(env, "select id from anonymous_sessions where session_token = ?", sessionToken).catch(() => null);
    sessionId = session?.id || null;
    await dbRun(env, "update anonymous_sessions set consent_state = ?, user_id = coalesce(?, user_id), last_seen_at = ? where session_token = ?",
      analytics ? "analytics" : "essential", user?.id || null, now, sessionToken).catch(() => {});
  }
  await dbRun(env, `insert into privacy_consents
    (id, user_id, session_id, policy_version, essential, analytics, global_privacy_control, source, created_at, updated_at)
    values (?, ?, ?, ?, 1, ?, ?, 'web', ?, ?)`,
  crypto.randomUUID(), user?.id || null, sessionId, env.PRIVACY_POLICY_VERSION || "2026-07-22",
  analytics ? 1 : 0, gpc ? 1 : 0, now, now).catch(() => {});
  if (user) {
    await dbRun(env, "update users set analytics_consent = ?, analytics_consent_updated_at = ?, updated_at = ? where id = ?",
      analytics ? 1 : 0, now, now, user.id);
  }
  return jsonResponse({ essential: true, analytics, global_privacy_control: gpc }, {
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": serializeCookieHeader(CONSENT_COOKIE, analytics ? "analytics" : "essential", {
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: CONSENT_MAX_AGE_SECONDS
      })
    }
  });
}

function normalizeSavedSearch(row) {
  return row ? { ...row, query: parseJSONCell(row.query_json, {}), alerts_enabled: Boolean(row.alerts_enabled) } : null;
}

async function handleSavedSearches(request, env, id = null) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  if (request.method === "GET" && !id) {
    const rows = await dbAll(env, "select * from saved_searches where user_id = ? order by updated_at desc", auth.user.id);
    return jsonResponse({ searches: rows.map(normalizeSavedSearch) });
  }
  if (request.method === "POST" && !id) {
    const payload = await readJSON(request);
    if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
    const name = cleanString(payload?.name, 100);
    const query = payload?.query && typeof payload.query === "object" && !Array.isArray(payload.query) ? payload.query : null;
    if (!name || !query) return errorResponse(400, "saved_search_name_and_query_required");
    normalizeJobQuery(query);
    const now = new Date().toISOString();
    const searchId = crypto.randomUUID();
    try {
      await dbRun(env, `insert into saved_searches
        (id, user_id, name, query_json, alerts_enabled, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)`, searchId, auth.user.id, name, jsonText(query), payload.alerts_enabled ? 1 : 0, now, now);
    } catch {
      return errorResponse(409, "saved_search_name_exists");
    }
    return jsonResponse({ search: normalizeSavedSearch(await dbFirst(env, "select * from saved_searches where id = ? and user_id = ?", searchId, auth.user.id)) }, { status: 201 });
  }
  if (!id) return errorResponse(405, "method_not_allowed");
  const existing = await dbFirst(env, "select * from saved_searches where id = ? and user_id = ?", id, auth.user.id);
  if (!existing) return errorResponse(404, "saved_search_not_found");
  if (request.method === "DELETE") {
    await dbRun(env, "delete from saved_searches where id = ? and user_id = ?", id, auth.user.id);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  if (request.method === "PATCH") {
    const payload = await readJSON(request);
    if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
    if (!payload) return errorResponse(400, "invalid_json");
    const name = payload.name == null ? existing.name : cleanString(payload.name, 100);
    const query = payload.query == null ? parseJSONCell(existing.query_json, {}) : payload.query;
    if (!name || !query || typeof query !== "object" || Array.isArray(query)) return errorResponse(400, "invalid_saved_search");
    normalizeJobQuery(query);
    await dbRun(env, `update saved_searches set name = ?, query_json = ?, alerts_enabled = ?, updated_at = ?
      where id = ? and user_id = ?`, name, jsonText(query), payload.alerts_enabled == null ? existing.alerts_enabled : (payload.alerts_enabled ? 1 : 0),
    new Date().toISOString(), id, auth.user.id);
    return jsonResponse({ search: normalizeSavedSearch(await dbFirst(env, "select * from saved_searches where id = ? and user_id = ?", id, auth.user.id)) });
  }
  return errorResponse(405, "method_not_allowed");
}

async function handleAlertPreferences(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  await ensureAccountRows(env, auth.user);
  const existing = await dbFirst(env, "select * from alert_preferences where user_id = ?", auth.user.id);
  if (request.method === "GET") {
    return jsonResponse({
      alerts_enabled: Boolean(existing?.alerts_enabled),
      delivery: existing?.delivery || "daily",
      local_hour: Number(existing?.local_hour ?? 8),
      timezone: existing?.timezone || "UTC"
    });
  }
  if (request.method !== "PATCH") return methodNotAllowed(["GET", "PATCH"]);
  const payload = await readJSON(request);
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
  if (!payload || typeof payload !== "object") return errorResponse(400, "invalid_json");
  const delivery = payload.delivery == null ? (existing?.delivery || "daily") : cleanString(payload.delivery, 20);
  if (!["immediate", "daily", "weekly"].includes(delivery)) return errorResponse(400, "invalid_alert_delivery");
  const localHour = payload.local_hour == null ? Number(existing?.local_hour ?? 8) : Number(payload.local_hour);
  if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) return errorResponse(400, "invalid_alert_hour");
  const timezone = payload.timezone == null ? (existing?.timezone || "UTC") : cleanString(payload.timezone, 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    return errorResponse(400, "invalid_timezone");
  }
  const enabled = payload.alerts_enabled == null ? Boolean(existing?.alerts_enabled) : Boolean(payload.alerts_enabled);
  const now = new Date().toISOString();
  await dbRun(env, `insert into alert_preferences
    (user_id, alerts_enabled, delivery, local_hour, timezone, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(user_id) do update set alerts_enabled = excluded.alerts_enabled,
      delivery = excluded.delivery, local_hour = excluded.local_hour,
      timezone = excluded.timezone, updated_at = excluded.updated_at`,
  auth.user.id, enabled ? 1 : 0, delivery, localHour, timezone, now, now);
  return jsonResponse({ alerts_enabled: enabled, delivery, local_hour: localHour, timezone });
}

async function handleStatus(request, env, admin = false) {
  if (admin) {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    const ownerError = requireAnalyticsOwner(auth, env);
    if (ownerError) return ownerError;
    const [latestRun, pendingDeletions, failedBuilds] = await Promise.all([
      dbFirst(env, "select * from scan_runs order by scan_date desc limit 1"),
      dbFirst(env, "select count(*) as count from account_deletion_requests where status in ('pending','processing','retrying')"),
      dbFirst(env, "select count(*) as count from resume_builds where status = 'FAILED' and updated_at >= datetime('now','-1 day')")
    ]);
    return jsonResponse({ latest_scan: latestRun, pending_deletions: Number(pendingDeletions?.count || 0), failed_builds_24h: Number(failedBuilds?.count || 0) });
  }
  const data = await readJobsPayloadSafe(env);
  return jsonResponse({
    status: data.scan_meta?.failCount ? "degraded" : "ok",
    last_scan: data.last_scan || null,
    last_scan_at: data.last_scan_at || null,
    feed_version: data.feed_version || null,
    active_jobs: (data.postings || []).filter(posting => !posting.last_filled).length
  }, { headers: { "Cache-Control": "public, max-age=60" } });
}

function decodeBase64Bytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 ? "=".repeat(4 - normalized.length % 4) : "";
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function verifyClerkWebhook(request, rawBody, env) {
  if (!env.CLERK_WEBHOOK_SECRET) return false;
  const id = request.headers.get("svix-id") || "";
  const timestamp = request.headers.get("svix-timestamp") || "";
  const signatureHeader = request.headers.get("svix-signature") || "";
  const timestampMs = Number(timestamp) * 1000;
  if (!id || !Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false;
  try {
    const secret = env.CLERK_WEBHOOK_SECRET.startsWith("whsec_")
      ? env.CLERK_WEBHOOK_SECRET.slice(6)
      : env.CLERK_WEBHOOK_SECRET;
    const key = await crypto.subtle.importKey("raw", decodeBase64Bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
    return signatureHeader.split(" ").some(entry => {
      const [version, signature] = entry.split(",");
      return version === "v1" && signature && timingSafeEqual(signature, expected);
    });
  } catch {
    return false;
  }
}

async function handleClerkWebhook(request, env) {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > 64 * 1024) return errorResponse(413, "request_too_large");
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) return errorResponse(413, "request_too_large");
  if (!await verifyClerkWebhook(request, rawBody, env)) return errorResponse(401, "invalid_webhook_signature");
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "invalid_json");
  }
  const data = event?.data || {};
  const userId = cleanString(data.id, 160);
  if (!userId) return errorResponse(400, "webhook_user_id_required");
  if (event.type === "user.created" || event.type === "user.updated") {
    const primary = (data.email_addresses || []).find(item => item.id === data.primary_email_address_id) || data.email_addresses?.[0];
    await ensureAccountRows(env, {
      id: userId,
      email: cleanString(primary?.email_address, 320),
      full_name: [data.first_name, data.last_name].map(value => cleanString(value, 100)).filter(Boolean).join(" ") || null
    });
    return jsonResponse({ ok: true });
  }
  if (event.type === "user.deleted") {
    const existing = await dbFirst(env, "select id from users where id = ?", userId);
    if (!existing) return jsonResponse({ ok: true, already_deleted: true });
    const deletionId = `clerk:${cleanString(event.id, 160) || crypto.randomUUID()}`;
    const at = new Date().toISOString();
    await dbRun(env, `insert into account_deletion_requests
      (id, user_id, user_hash, source, status, current_step, created_at, updated_at)
      values (?, ?, ?, 'clerk_webhook', 'pending', 'requested', ?, ?)
      on conflict(id) do nothing`, deletionId, userId, await sha256Base64Url(`deleted-user:${userId}`), at, at);
    await dbRun(env, "update users set lifecycle_state = 'deletion_pending', deletion_requested_at = ?, updated_at = ? where id = ?", at, at, userId);
    if (env.ACCOUNT_WORKFLOW?.create) {
      try {
        await env.ACCOUNT_WORKFLOW.create({ id: deletionId, params: { type: "delete_account", request_id: deletionId } });
      } catch (failure) {
        if (!String(failure?.message || "").toLowerCase().includes("already")) throw failure;
      }
    } else {
      await processAccountDeletion(env, deletionId);
    }
    return jsonResponse({ ok: true }, { status: 202 });
  }
  return jsonResponse({ ok: true, ignored: true });
}

async function handleAgencyFeedback(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
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
  if (env.DB && env.JOB_FEEDS) {
    try {
      const publication = await dbFirst(env, `select p.version, p.r2_key
        from feed_pointer fp join feed_publications p on p.version = fp.current_version
        where fp.singleton = 1`);
      if (publication?.r2_key) {
        const object = await env.JOB_FEEDS.get(publication.r2_key);
        if (object) {
          const published = await object.json();
          return {
            ...published,
            feed_version: publication.version,
            postings: Array.isArray(published.postings)
              ? published.postings.map(posting => ({ ...posting, tier: normalizeTier(posting.tier) }))
              : []
          };
        }
      }
    } catch (failure) {
      console.error(JSON.stringify({ event: "feed_publication_read_failed", message: failure?.message || String(failure) }));
    }
  }
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
  if (!env.KV && !(env.DB && env.JOB_FEEDS)) {
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
  if (!result?.next || !env.DB) return;
  const date = scanDate || result.next.scan_cycle?.date || result.next.last_scan || todayUTC();
  const scanRunId = `scan:${date}`;
  const now = new Date().toISOString();
  const meta = result.next.scan_meta || {};
  await dbRun(env, `insert into scan_runs
    (id, scan_date, status, expected_shards, completed_shards, total_jobs, ok_sources,
     failed_sources, partial_sources, started_at, updated_at, completed_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(scan_date) do update set
      status = excluded.status,
      completed_shards = excluded.completed_shards,
      total_jobs = excluded.total_jobs,
      ok_sources = excluded.ok_sources,
      failed_sources = excluded.failed_sources,
      partial_sources = excluded.partial_sources,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at`,
  scanRunId,
  date,
  result.cycleComplete ? (Number(meta.failCount || 0) ? "degraded" : "complete") : "running",
  Number(result.next.scan_cycle?.total_shards || SCAN_CRONS.length),
  Number(result.next.scan_cycle?.completed_shards?.length || 0),
  Object.keys(result.next.postings || {}).length,
  Number(meta.okCount || 0),
  Number(meta.failCount || 0),
  Number(meta.partialCount || 0),
  now,
  now,
  result.cycleComplete ? now : null);

  await dbRun(env, `insert into scan_shards
    (id, scan_run_id, shard_index, status, ok_count, fail_count, partial_count, started_at, completed_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(scan_run_id, shard_index) do update set
      status = excluded.status,
      ok_count = excluded.ok_count,
      fail_count = excluded.fail_count,
      partial_count = excluded.partial_count,
      completed_at = excluded.completed_at`,
  `${scanRunId}:${result.shardIndex}`,
  scanRunId,
  Number(result.shardIndex || 0),
  Number(result.failCount || 0) ? "degraded" : "complete",
  Number(result.okCount || 0),
  Number(result.failCount || 0),
  Number(result.partialCount || 0),
  now,
  now);

  const sourceStatements = [];
  const database = db(env);
  const sourceMeta = meta.sourceMeta || {};
  for (const sourceId of meta.okSources || []) {
    sourceStatements.push(database.prepare(`insert into scan_sources
      (id, scan_run_id, source_id, status, posting_count, updated_at)
      values (?, ?, ?, 'complete', ?, ?)
      on conflict(scan_run_id, source_id) do update set status = excluded.status,
        posting_count = excluded.posting_count, error_code = null, updated_at = excluded.updated_at`)
      .bind(`${scanRunId}:${sourceId}`, scanRunId, sourceId, Number(sourceMeta[sourceId]?.count || 0), now));
  }
  for (const sourceId of meta.partialSources || []) {
    sourceStatements.push(database.prepare(`insert into scan_sources
      (id, scan_run_id, source_id, status, posting_count, updated_at)
      values (?, ?, ?, 'partial', ?, ?)
      on conflict(scan_run_id, source_id) do update set status = excluded.status,
        posting_count = excluded.posting_count, updated_at = excluded.updated_at`)
      .bind(`${scanRunId}:${sourceId}`, scanRunId, sourceId, Number(sourceMeta[sourceId]?.count || 0), now));
  }
  for (const sourceId of meta.failedSources || []) {
    sourceStatements.push(database.prepare(`insert into scan_sources
      (id, scan_run_id, source_id, status, posting_count, error_code, updated_at)
      values (?, ?, ?, 'carried_forward', 0, 'source_fetch_failed', ?)
      on conflict(scan_run_id, source_id) do update set status = excluded.status,
        error_code = excluded.error_code, updated_at = excluded.updated_at`)
      .bind(`${scanRunId}:${sourceId}`, scanRunId, sourceId, now));
  }
  await dbBatch(env, sourceStatements);

  if (!result.cycleComplete) return;
  await persistScanToD1(env, result.next, date, scanRunId);
  if (!env.JOB_FEEDS) return;

  const feedPayload = JSON.stringify({
    last_scan: result.next.last_scan,
    last_scan_at: result.next.last_scan_at,
    last_partial_scan_at: result.next.last_partial_scan_at,
    scan_cycle: result.next.scan_cycle,
    scan_meta: result.next.scan_meta,
    postings: Object.values(result.next.postings || {})
  });
  const digest = await sha256Base64Url(feedPayload);
  const version = `${date}-${digest.slice(0, 16)}`;
  const r2Key = `feeds/${date}/${version}.json`;
  await env.JOB_FEEDS.put(r2Key, feedPayload, {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { version, scanRunId, sha256: digest }
  });

  const current = await dbFirst(env, "select current_version from feed_pointer where singleton = 1");
  await dbBatch(env, [
    database.prepare(`insert into feed_publications
      (version, scan_run_id, r2_key, sha256, byte_size, job_count, status, created_at, activated_at)
      values (?, ?, ?, ?, ?, ?, 'current', ?, ?)
      on conflict(version) do update set status = 'current', activated_at = excluded.activated_at`)
      .bind(version, scanRunId, r2Key, digest, new TextEncoder().encode(feedPayload).byteLength,
        Object.keys(result.next.postings || {}).length, now, now),
    database.prepare("update feed_publications set status = 'retired' where status = 'current' and version <> ?").bind(version),
    database.prepare(`insert into feed_pointer (singleton, current_version, previous_version, updated_at)
      values (1, ?, ?, ?)
      on conflict(singleton) do update set previous_version = feed_pointer.current_version,
        current_version = excluded.current_version, updated_at = excluded.updated_at`)
      .bind(version, current?.current_version || null, now),
    database.prepare("update scan_runs set feed_version = ?, updated_at = ? where id = ?").bind(version, now, scanRunId)
  ]);
}

async function maybeRefreshStaleJobs(env, ctx, data) {
  if (!ctx?.waitUntil || !env.KV || !jobsPayloadIsStale(data)) return;

  const shardIndex = nextIncompleteShard(data, todayUTC());
  const lockKey = `${STALE_SCAN_LOCK_KEY_PREFIX}:${todayUTC()}:${shardIndex}`;
  const lockToken = crypto.randomUUID();

  try {
    const existingLock = await env.KV.get(lockKey);
    if (existingLock) return;

    await env.KV.put(lockKey, lockToken, {
      expirationTtl: STALE_SCAN_LOCK_TTL_SECONDS
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "stale_scan_lock_failed", shardIndex, message: error?.message || String(error) }));
    return;
  }

  ctx.waitUntil((async () => {
    let completed = false;
    try {
      const result = await runScan(env, { shardIndex });
      if (result.error) {
        console.error(JSON.stringify({ event: "stale_scan_failed", shardIndex, ...result }));
        return;
      }
      await persistSuccessfulScan(env, result);
      completed = true;
    } catch (error) {
      console.error(JSON.stringify({ event: "stale_scan_failed", shardIndex, message: error?.message || String(error) }));
    } finally {
      if (completed) {
        try {
          const currentLock = await env.KV.get(lockKey);
          if (currentLock === lockToken) await env.KV.delete(lockKey);
        } catch (error) {
          console.error(JSON.stringify({ event: "stale_scan_unlock_failed", shardIndex, message: error?.message || String(error) }));
        }
      }
    }
  })());
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

function renderSeoPage(path, summary, nonce) {
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
<meta property="og:image" content="${SITE_ORIGIN}/assets/og-image.webp">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHTML(page.title)}">
<meta name="twitter:description" content="${escapeHTML(page.description)}">
<meta name="twitter:image" content="${SITE_ORIGIN}/assets/og-image.webp">
<script type="application/ld+json" nonce="${nonce}">${JSON.stringify(jsonLd)}</script>
<link rel="stylesheet" href="/seo.css">
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
  const nonce = crypto.randomUUID();
  const html = renderSeoPage(path, summarizeJobsPayload(data), nonce);
  return withTrustHeaders(new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "public, max-age=300"
    }
  }), nonce);
}

function safeJsonLd(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

async function handlePublicJobPage(request, env, jobId) {
  const data = await readJobsPayloadSafe(env);
  const job = (data.postings || []).find(posting => String(posting.id) === String(jobId));
  if (!job) return withTrustHeaders(new Response("Job not found", { status: 404, headers: { "Content-Type": "text/plain; charset=UTF-8" } }));
  const filled = Boolean(job.last_filled);
  const canonical = `${SITE_ORIGIN}/jobs/${encodeURIComponent(job.id)}/${slugify(job.company)}-${slugify(job.title)}`;
  const schema = !filled ? {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: `${job.title} at ${job.company}. Confirm details and application requirements on the employer's careers page.`,
    datePosted: job.first_seen || data.last_scan,
    validThrough: job.last_seen || undefined,
    employmentType: "FULL_TIME",
    hiringOrganization: { "@type": "Organization", name: job.company },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.city || job.location || undefined,
        addressCountry: job.country || undefined
      }
    },
    directApply: false,
    url: canonical
  } : null;
  const nonce = crypto.randomUUID();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(job.title)} at ${escapeHTML(job.company)} | Live Job Index</title>
<meta name="description" content="${escapeHTML(`${job.title} at ${job.company} in ${job.location || job.country || "a global market"}. Review current role and visa-aware hiring signals.`)}">
<link rel="canonical" href="${escapeHTML(canonical)}">${filled ? '<meta name="robots" content="noindex,follow">' : ""}
${schema ? `<script type="application/ld+json" nonce="${nonce}">${safeJsonLd(schema)}</script>` : ""}
<link rel="stylesheet" href="/app.css"></head><body><main class="seo-job-page">
<p><a href="/">← Live jobs</a></p><p class="eyebrow">${filled ? "Previously listed" : "Confirmed live posting"}</p>
<h1>${escapeHTML(job.title)}</h1><h2>${escapeHTML(job.company)}</h2>
<dl><dt>Location</dt><dd>${escapeHTML(job.location || job.country || "See employer page")}</dd><dt>Role family</dt><dd>${escapeHTML(job.role_family || "Other")}</dd><dt>Seniority</dt><dd>${escapeHTML(job.seniority || "Not specified")}</dd><dt>Visa signal</dt><dd>${escapeHTML(job.visa || "Unknown")} — heuristic, not a guarantee</dd></dl>
${filled ? "<p>This posting is no longer present in the employer feed.</p>" : `<p><a class="primary-btn" href="${escapeHTML(safeApplyUrl(job.url))}" rel="noopener noreferrer">Open employer application</a></p>`}
<p><a href="/app/jobs">Open Live Job Index app</a></p></main></body></html>`;
  return withTrustHeaders(new Response(html, {
    headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=300" }
  }), nonce);
}

async function handleSitemap(env) {
  const data = await readJobsPayloadSafe(env);
  const staticPages = ["", "/jobs", "/visa-roles", "/pipeline", "/insights", "/privacy", "/terms"];
  const urls = staticPages.map(path => ({ loc: `${SITE_ORIGIN}${path || "/"}`, lastmod: data.last_scan || null }));
  for (const job of (data.postings || []).filter(item => !item.last_filled).slice(0, 49900)) {
    urls.push({
      loc: `${SITE_ORIGIN}/jobs/${encodeURIComponent(job.id)}/${slugify(job.company)}-${slugify(job.title)}`,
      lastmod: job.last_seen || data.last_scan || null
    });
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(item =>
    `<url><loc>${escapeHTML(item.loc)}</loc>${item.lastmod ? `<lastmod>${escapeHTML(item.lastmod)}</lastmod>` : ""}</url>`).join("")}</urlset>`;
  return withTrustHeaders(new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=UTF-8", "Cache-Control": "public, max-age=300" }
  }));
}

async function handlePublicJobs(request, env, ctx) {
  const url = new URL(request.url);
  const requestedIndustry = url.searchParams.get("industry") || INDUSTRIES.TECH;
  const industry = Object.values(INDUSTRIES).includes(requestedIndustry) ? requestedIndustry : INDUSTRIES.TECH;
  const cursor = url.searchParams.get("cursor");
  const cursorState = decodeJobCursor(cursor);
  if (cursor && !cursorState) return errorResponse(400, "invalid_cursor");
  let authenticated = false;
  if (cursorState?.page > 1) {
    const auth = await requireUser(request, env);
    if (auth.response) return errorResponse(401, "auth_required", { sign_in_url: "/api/login?next=/app/jobs" });
    authenticated = true;
  } else if (hasAuthMaterial(request)) {
    const auth = await requireUser(request, env);
    authenticated = !auth.response;
  }
  const data = await readJobsPayload(env);
  await maybeRefreshStaleJobs(env, ctx, data);
  const query = normalizeJobQuery({
    page: cursorState?.page || 1,
    per_page: clampInteger(url.searchParams.get("limit"), JOB_PAGE_SIZE, 1, MAX_JOB_PAGE_SIZE),
    sort: url.searchParams.get("sort") || "first_seen",
    dir: url.searchParams.get("dir") || "desc",
    search: url.searchParams.get("search") || "",
    industry,
    active_only: true,
    filters: {
      industry: [industry],
      country: url.searchParams.getAll("country"),
      family: url.searchParams.getAll("family"),
      seniority: url.searchParams.getAll("seniority"),
      visa: url.searchParams.getAll("visa")
    }
  });
  const payload = cursorJobResponse(pagePostings(data, query), data, query, authenticated);
  const etag = `W/"${await sha256Base64Url(`${payload.feed_version || "empty"}:${url.search}`)}"`;
  const cacheHeaders = {
    "Cache-Control": hasAuthMaterial(request) ? "no-store" : "public, max-age=300, stale-while-revalidate=300",
    ETag: etag,
    Vary: "Cookie, Authorization"
  };
  if (request.headers.get("If-None-Match") === etag) {
    return withTrustHeaders(new Response(null, { status: 304, headers: cacheHeaders }));
  }
  return jsonResponse(payload, {
    headers: cacheHeaders
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
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
  if (!payload) return errorResponse(400, "invalid_json");

  const query = normalizeJobQuery(payload);

  let authenticated = false;
  if (query.page > 1 || query.filters.presets.includes("starred")) {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    authenticated = true;
    if (query.filters.presets.includes("starred")) {
      const starred = await dbAll(
        env,
        "select job_id from user_jobs where user_id = ? and starred = 1",
        auth.user.id
      );
      query.starredIds = new Set(starred.map(row => String(row.job_id)));
    }
  }

  const data = await readJobsPayload(env);
  await maybeRefreshStaleJobs(env, ctx, data);
  return jsonResponse(cursorJobResponse(pagePostings(data, query), data, query, authenticated), {
    headers: { "Cache-Control": "no-store" }
  });
}

async function handleGetUserJobs(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const rows = await dbAll(env, "select * from user_jobs where user_id = ? order by updated_at desc", auth.user.id);
  const hydratedRows = await dbAll(env, `
    select
      uj.job_id,
      jp.source,
      jp.source_token,
      jp.company,
      jp.title,
      jp.url,
      jp.first_seen_date,
      jp.last_seen_date,
      jp.last_filled_date,
      coalesce(js.industry, jp.industry) as industry,
      coalesce(js.niche, jp.niche) as niche,
      js.location,
      js.city,
      js.country,
      js.role_family,
      js.seniority,
      js.visa,
      js.score,
      js.tier
    from user_jobs uj
    join job_postings jp on jp.id = uj.job_id
    left join job_snapshots js on js.id = (
      select latest.id
      from job_snapshots latest
      where latest.job_id = uj.job_id
      order by latest.scan_date desc, latest.id desc
      limit 1
    )
    where uj.user_id = ?
  `, auth.user.id);
  const postings = new Map(hydratedRows.map(row => [String(row.job_id), {
    id: row.job_id,
    source: row.source,
    source_token: row.source_token,
    company: row.company,
    title: row.title,
    url: row.url,
    industry: row.industry || INDUSTRIES.TECH,
    niche: row.niche || TECH_NICHE,
    location: row.location,
    city: row.city || row.location,
    country: row.country,
    role_family: row.role_family || classifyRoleFamily(row.title) || "Other",
    seniority: row.seniority || classifySeniority(row.title),
    visa: row.visa || "Unknown",
    score: row.score,
    tier: normalizeTier(row.tier),
    first_seen: row.first_seen_date,
    last_seen: row.last_seen_date,
    last_filled: row.last_filled_date
  }]));
  return jsonResponse({
    jobs: rows.map(row => {
      const job = normalizeUserJob(row);
      const posting = postings.get(String(job.job_id));
      return posting ? { ...job, posting } : job;
    })
  });
}

async function handlePutUserJob(request, env, jobId) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const payload = await readJSON(request);
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
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
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
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

async function coordinatedScan(env, options = {}) {
  if (!env.SCAN_COORDINATOR?.getByName) {
    const result = await runScan(env, options);
    if (!result.error) await persistSuccessfulScan(env, result, options.scanDate || null);
    return result;
  }
  const scanDate = options.scanDate || todayUTC();
  const coordinator = env.SCAN_COORDINATOR.getByName(scanDate);
  const response = await coordinator.fetch("https://scan-coordinator.internal/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shardIndex: normalizeShardIndex(options.shardIndex), scanDate })
  });
  const payload = await response.json();
  if (!response.ok) return { error: payload.error || "scan_coordination_failed", ...payload };
  return payload;
}

export class ScanCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/run" || request.method !== "POST") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const payload = await request.json().catch(() => ({}));
    const scanDate = /^\d{4}-\d{2}-\d{2}$/.test(payload.scanDate || "") ? payload.scanDate : todayUTC();
    const shardIndex = normalizeShardIndex(payload.shardIndex);
    const active = await this.state.storage.get("active");
    if (active) {
      return Response.json({ error: "scan_already_running", active }, { status: 409 });
    }
    const claim = { id: crypto.randomUUID(), scanDate, shardIndex, startedAt: new Date().toISOString() };
    await this.state.storage.put("active", claim);
    try {
      const result = await runScan(this.env, { shardIndex });
      if (result.error) return Response.json(result, { status: 503 });
      await persistSuccessfulScan(this.env, result, scanDate);
      await this.state.storage.put("last_result", {
        scanDate,
        shardIndex,
        cycleComplete: result.cycleComplete,
        completedAt: new Date().toISOString()
      });
      return Response.json({
        okCount: result.okCount,
        failCount: result.failCount,
        partialCount: result.partialCount,
        total: result.total,
        shardIndex: result.shardIndex,
        completedShards: result.completedShards,
        cycleComplete: result.cycleComplete
      });
    } catch (failure) {
      console.error(JSON.stringify({
        event: "coordinated_scan_failed",
        scanDate,
        shardIndex,
        message: failure?.message || String(failure)
      }));
      return Response.json({ error: "scan_failed" }, { status: 503 });
    } finally {
      await this.state.storage.delete("active");
    }
  }
}

export class UserMutationCoordinator {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const payload = await request.json().catch(() => ({}));
    const key = cleanString(payload.key, 200);
    if (!key) return Response.json({ error: "key_required" }, { status: 400 });
    if (url.pathname === "/claim" && request.method === "POST") {
      const current = await this.state.storage.get(`claim:${key}`);
      const now = Date.now();
      if (current?.expiresAt > now) return Response.json({ error: "operation_in_progress" }, { status: 409 });
      const claim = { token: crypto.randomUUID(), expiresAt: now + clampInteger(payload.ttl_ms, 30000, 1000, 300000) };
      await this.state.storage.put(`claim:${key}`, claim, { expirationTtl: Math.ceil((claim.expiresAt - now) / 1000) });
      return Response.json(claim, { status: 201 });
    }
    if (url.pathname === "/release" && request.method === "POST") {
      const current = await this.state.storage.get(`claim:${key}`);
      if (current && timingSafeEqual(String(current.token || ""), String(payload.token || ""))) {
        await this.state.storage.delete(`claim:${key}`);
      }
      return Response.json({ ok: true });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }
}

export class RateLimitCoordinator {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
    const payload = await request.json().catch(() => ({}));
    const key = cleanString(payload.key, 200);
    const limit = clampInteger(payload.limit, 60, 1, 10000);
    const windowSeconds = clampInteger(payload.window_seconds, 60, 1, 86400);
    const cost = clampInteger(payload.cost, 1, 1, limit);
    if (!key) return Response.json({ error: "key_required" }, { status: 400 });
    const bucket = `limit:${key}`;
    const now = Date.now();
    const current = await this.state.storage.get(bucket);
    const record = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowSeconds * 1000 }
      : current;
    const allowed = record.count + cost <= limit;
    if (allowed) {
      record.count += cost;
      await this.state.storage.put(bucket, record, { expirationTtl: windowSeconds + 1 });
    }
    return Response.json({
      allowed,
      limit,
      remaining: Math.max(0, limit - record.count),
      retry_after: allowed ? 0 : Math.max(1, Math.ceil((record.resetAt - now) / 1000))
    }, { status: allowed ? 200 : 429 });
  }
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
      const declaredLength = Number(request.headers.get("Content-Length") || 0);
      const studioMutation = url.pathname.startsWith("/api/resume-") || url.pathname.startsWith("/api/evidence")
        || url.pathname.startsWith("/api/custom-jobs") || url.pathname.startsWith("/api/build-rules")
        || url.pathname.startsWith("/api/notifications") || /\/application-pack$/.test(url.pathname);
      const limit = url.pathname === "/api/track" ? MAX_TRACKING_BODY_BYTES
        : (url.pathname === "/api/resume-sources" ? 10 * 1024 * 1024 : studioMutation ? 100 * 1024 : MAX_JSON_BODY_BYTES);
      if (Number.isFinite(declaredLength) && declaredLength > limit) return errorResponse(413, "request_too_large");
    }

    if (url.pathname.startsWith("/api/")) {
      let limitRule = request.method === "GET"
        ? { scope: "public_read", limit: 120, windowSeconds: 60 }
        : { scope: "mutation", limit: 60, windowSeconds: 60 };
      if (url.pathname === "/api/session") limitRule = { scope: "session", limit: 10, windowSeconds: 3600 };
      if (url.pathname === "/api/track") limitRule = { scope: "tracking", limit: 60, windowSeconds: 60 };
      const limited = await enforceRateLimit(request, env, limitRule);
      if (limited) return limited;
    }

    if (url.pathname === "/privacy") {
      return fetchAsset(request, env, "/privacy.html");
    }

    if (url.pathname === "/terms") {
      return fetchAsset(request, env, "/terms.html");
    }

    if (url.pathname === "/sitemap.xml") return handleSitemap(env);

    const legacyAppRoutes = {
      "/resumes": "/app/resumes",
      "/archive": "/app/archive",
      "/history": "/app/archive",
      "/onboarding": "/app/onboarding",
      "/settings": "/app/settings",
      "/profile": "/app/settings"
    };
    if (legacyAppRoutes[url.pathname]) {
      const destination = new URL(legacyAppRoutes[url.pathname], SITE_ORIGIN);
      destination.search = url.search;
      return redirectResponse(destination.toString(), 308);
    }

    const publicJobMatch = url.pathname.match(/^\/jobs\/([^/]+)(?:\/[^/]+)?$/);
    if (publicJobMatch) {
      return handlePublicJobPage(request, env, decodeURIComponent(publicJobMatch[1]));
    }

    if (SEO_PAGES[url.pathname]) {
      return handleSeoPage(url.pathname, env);
    }

    if (url.pathname === "/api/email/unsubscribe") {
      return withTrustHeaders(await handleOneClickUnsubscribe(request, env, RESUME_STUDIO_DEPS));
    }

    const resumeStudioPath = url.pathname.startsWith("/api/resume-")
      || url.pathname.startsWith("/api/evidence")
      || url.pathname.startsWith("/api/custom-jobs")
      || url.pathname.startsWith("/api/build-rules")
      || url.pathname.startsWith("/api/notifications")
      || url.pathname === "/api/usage"
      || /^\/api\/jobs\/.+\/(preparation-context|application-pack)$/.test(url.pathname);
    if (resumeStudioPath) {
      const auth = await requireUser(request, env);
      if (auth.response) return auth.response;
      await ensureAccountRows(env, auth.user);
      const studioResponse = await handleResumeStudioRequest(
        request,
        env,
        ctx,
        auth.user,
        RESUME_STUDIO_DEPS
      );
      if (studioResponse) return withTrustHeaders(studioResponse);
    }

    if (url.pathname === "/api/jobs") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return handlePublicJobs(request, env, ctx);
    }

    if (url.pathname === "/api/status" && request.method === "GET") {
      return handleStatus(request, env, false);
    }

    if (url.pathname === "/api/admin/health" && request.method === "GET") {
      return handleStatus(request, env, true);
    }

    if (url.pathname === "/api/privacy/consent") {
      return handlePrivacyConsent(request, env);
    }

    if (url.pathname === "/api/saved-searches") {
      return handleSavedSearches(request, env);
    }

    if (url.pathname === "/api/alert-preferences") {
      return handleAlertPreferences(request, env);
    }

    const savedSearchMatch = url.pathname.match(/^\/api\/saved-searches\/([^/]+)$/);
    if (savedSearchMatch) {
      return handleSavedSearches(request, env, decodeURIComponent(savedSearchMatch[1]));
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

    if (url.pathname === "/api/me" && request.method === "DELETE") {
      return handleDeleteMe(request, env);
    }

    const deletionStatusMatch = url.pathname.match(/^\/api\/me\/deletion\/([^/]+)$/);
    if (deletionStatusMatch && request.method === "GET") {
      return handleDeletionStatus(request, env, decodeURIComponent(deletionStatusMatch[1]));
    }

    if (url.pathname === "/api/me/export") {
      return handleDataExports(request, env);
    }

    const exportMatch = url.pathname.match(/^\/api\/me\/export\/([^/]+)(\/download)?$/);
    if (exportMatch) {
      return handleDataExports(request, env, decodeURIComponent(exportMatch[1]), Boolean(exportMatch[2]));
    }

    if (url.pathname === "/api/webhooks/clerk" && request.method === "POST") {
      return handleClerkWebhook(request, env);
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
      if (request.method !== "POST") {
        const response = errorResponse(405, "method_not_allowed");
        const headers = new Headers(response.headers);
        headers.set("Allow", "POST");
        return withTrustHeaders(new Response(response.body, { status: 405, headers }));
      }
      const auth = request.headers.get("X-Scan-Key");
      if (!await timingSafeSecretEqual(auth, env.SCAN_KEY)) {
        return errorResponse(401, "unauthorized");
      }
      const current = await readJobsPayloadSafe(env);
      const requestedShard = url.searchParams.get("shard");
      if (requestedShard != null && (!/^\d+$/.test(requestedShard) || Number(requestedShard) >= SCAN_CRONS.length)) {
        return errorResponse(400, "shard must be an integer from 0 to 4");
      }
      const shardIndex = requestedShard == null
        ? nextIncompleteShard(current, todayUTC())
        : normalizeShardIndex(requestedShard);
      const result = await coordinatedScan(env, { shardIndex });
      if (result.error) {
        return jsonResponse(result, { status: 503 });
      }
      return jsonResponse({
        okCount: result.okCount,
        failCount: result.failCount,
        partialCount: result.partialCount,
        total: result.total,
        shardIndex: result.shardIndex,
        completedShards: result.completedShards,
        cycleComplete: result.cycleComplete
      });
    }

    if (url.pathname.startsWith("/api/")) {
      const allow = allowedApiMethods(url.pathname);
      return allow ? methodNotAllowed(allow) : errorResponse(404, "not_found");
    }
    return fetchAsset(request, env);
  },

  async scheduled(event, env, ctx) {
    const today = todayUTC();
    const shardIndex = scanShardForCron(event?.cron);
    const scanPromise = coordinatedScan(env, { shardIndex, scanDate: today }).then(async result => {
      if (result.error) {
        console.error(JSON.stringify({ event: "scheduled_scan_failed", shardIndex, ...result }));
        if (env.RESUME_QUEUE?.send) {
          await env.RESUME_QUEUE.send({ type: "scan_retry", shard_index: shardIndex, scan_date: today, attempt: 1 }, { contentType: "json", delaySeconds: 300 });
        }
        return;
      }
      if (Number(result.failCount || 0) > 0 && env.RESUME_QUEUE?.send) {
        await env.RESUME_QUEUE.send({ type: "scan_retry", shard_index: shardIndex, scan_date: today, attempt: 1 }, { contentType: "json", delaySeconds: 300 });
      }
      if (result.cycleComplete) {
        await dispatchDailyResumeMatching(env, RESUME_STUDIO_DEPS, today, ctx).catch(error => {
          console.error(JSON.stringify({ event: "resume_matching_failed", message: error?.message || String(error) }));
        });
        if (env.RESUME_QUEUE?.send && String(env.RESUME_EMAIL_DIGESTS_ENABLED).toLowerCase() === "true") {
          await env.RESUME_QUEUE.send({ type: "digest_tick", scheduled_at: new Date().toISOString() }, { contentType: "json", delaySeconds: 60 });
        }
        if (env.RESUME_QUEUE?.send) {
          await env.RESUME_QUEUE.send({ type: "maintenance_tick", scheduled_at: new Date().toISOString() }, { contentType: "json", delaySeconds: 120 });
        }
      }
    });
    if (ctx?.waitUntil) {
      ctx.waitUntil(scanPromise);
    } else {
      await scanPromise;
    }
  },

  async queue(batch, env) {
    const resumeMessages = [];
    for (const message of batch.messages || []) {
      if (message.body?.type !== "scan_retry") {
        resumeMessages.push(message);
        continue;
      }
      try {
        const result = await coordinatedScan(env, { shardIndex: normalizeShardIndex(message.body.shard_index), scanDate: message.body.scan_date || todayUTC() });
        if ((result.error || Number(result.failCount || 0) > 0) && Number(message.body.attempt || 1) < 3 && env.RESUME_QUEUE?.send) {
          await env.RESUME_QUEUE.send({ ...message.body, attempt: Number(message.body.attempt || 1) + 1 }, { contentType: "json", delaySeconds: 300 * Number(message.body.attempt || 1) });
        } else if (result.error || Number(result.failCount || 0) > 0) {
          console.error(JSON.stringify({ event: "scan_retry_exhausted", shardIndex: message.body.shard_index, scanDate: message.body.scan_date, result }));
        }
        message.ack?.();
      } catch (failure) {
        console.error(JSON.stringify({ event: "scan_retry_failed", message: failure?.message || String(failure) }));
        message.retry?.({ delaySeconds: 300 });
      }
    }
    if (resumeMessages.length) await handleResumeQueue({ messages: resumeMessages }, env, RESUME_STUDIO_DEPS);
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
  if (!analyticsConsentFromRequest(request)) {
    return jsonResponse({ ok: true, analytics: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const existing = getAnonSessionCookie(request);
  if (existing) {
    await dbRun(env, "update anonymous_sessions set last_seen_at = ? where session_token = ?", new Date().toISOString(), existing).catch(() => {});
    return jsonResponse({ ok: true, analytics: true });
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
    insert into anonymous_sessions (id, session_token, ip_hash, user_agent_fingerprint, created_at, last_seen_at, consent_state, expires_at)
    values (?, ?, null, null, ?, ?, 'analytics', ?)
    on conflict(session_token) do update set last_seen_at = excluded.last_seen_at,
      consent_state = 'analytics', expires_at = excluded.expires_at
  `, crypto.randomUUID(), token, new Date().toISOString(), new Date().toISOString(),
  new Date(Date.now() + ANON_SESSION_TTL_DAYS * 86400000).toISOString()).catch(() => {});

  return jsonResponse({ ok: true, analytics: true }, {
    headers: { "Set-Cookie": cookie }
  });
}

async function handleTrack(request, env) {
  if (!analyticsConsentFromRequest(request)) {
    return jsonResponse({ ok: true, tracked: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const payload = await readJSON(request, MAX_TRACKING_BODY_BYTES);
  if (payload === BODY_TOO_LARGE) return errorResponse(413, "request_too_large");
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

  const session = sessionToken
    ? await dbFirst(env, "select id from anonymous_sessions where session_token = ? and consent_state = 'analytics'", sessionToken).catch(() => null)
    : null;
  const sessionId = session?.id || null;

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
  } catch (failure) {
    console.error(JSON.stringify({ event: "analytics_event_write_failed", type: eventType, message: failure?.message || String(failure) }));
    return errorResponse(503, "analytics_unavailable");
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
