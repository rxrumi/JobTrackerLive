// Cloudflare Worker — Job Tracker
// Serves the static HTML and exposes /api/jobs (KV-backed).
// Cron handler (0 3 * * * UTC = 7 AM Dubai) scans Greenhouse APIs daily.

const GREENHOUSE_TOKENS = [
  "gongio", "klaviyo", "datadog", "cloudflare", "hubspot",
  "pleo", "celonis", "airtable", "gitlab", "figma",
  "brex", "mercury", "vercel", "typeform", "feedzai",
  "mentimeter", "trustpilot", "twilio", "asana",
  "databricks", "mongodb", "elastic", "remote",
  "sumologic", "contentful", "n26", "cognite"
];

const ASHBY_TOKENS = [
  "confluent", "deel", "linear", "mollie",
  "notion", "ramp", "snowflake", "xero"
];

const LEVER_TOKENS = ["pipedrive"];

const SMARTRECRUITERS_TOKENS = ["canva", "wise"];

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

const ROLE_KEYWORDS = [
  "revenue operations", "revops", "rev ops",
  "sales operations", "sales ops",
  "marketing operations", "marketing ops",
  "business operations", "biz ops",
  "gtm operations", "gtm ops", "go-to-market operations",
  "field operations",
  "sales strategy", "revenue strategy", "sales excellence",
  "strategy and operations", "strategy & operations"
];

const HIGH_FIT_COMPANIES = new Set([
  "hubspot", "gongio", "klaviyo", "pleo", "personio",
  "typeform", "factorialhr", "talkdesk", "mollie", "pipedrive",
  "mentimeter", "deel", "kahoot", "notion", "xero", "trustpilot", "miro"
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
  for (const [city, code] of Object.entries(CITY_TO_COUNTRY)) {
    if (locationName.includes(city)) return { country: code, city };
  }
  return null;
}

function matchKeywords(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  return ROLE_KEYWORDS.some(k => t.includes(k));
}

function classifyTier(token) {
  if (ECOSYSTEM_COMPANIES.has(token)) return "Ecosystem";
  if (SCALEUP_COMPANIES.has(token)) return "Scaleup";
  return "BigTech";
}

function classifyFit(token) {
  return HIGH_FIT_COMPANIES.has(token) ? "High" : "Med";
}

function calcScore(fit, visa) {
  const fitW = { High: 100, Med: 70, Low: 40 };
  const visaW = { Strong: 100, Likely: 75, Unknown: 50 };
  return Math.round(fitW[fit] * 0.4 + visaW[visa] * 0.4 + 85 * 0.2);
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
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
    const results = await Promise.allSettled(batch.map(async s => ({ s, jobs: await s.fetch(s.token) })));

    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value.jobs) {
        failCount++;
        continue;
      }
      okCount++;
      const { s, jobs } = r.value;
      for (const job of jobs) {
        const loc = matchCountry(job.location);
        if (!loc) continue;
        if (!matchKeywords(job.title)) continue;

        const id = `${s.source}-${s.token}-${job.id}`;
        const existed = prev.postings[id];
        const fit = classifyFit(s.token);
        const visa = "Strong";

        found[id] = {
          id,
          source: s.source,
          company: s.token,
          title: job.title,
          location: job.location,
          city: loc.city,
          country: loc.country,
          url: job.url,
          tier: classifyTier(s.token),
          stack_fit: fit,
          visa,
          score: calcScore(fit, visa),
          first_seen: existed?.first_seen || today,
          last_seen: today,
          last_filled: null
        };
      }
    }
  }

  if (okCount === 0) {
    return { error: "all_fetch_failed", okCount, failCount };
  }

  const merged = {};
  for (const [id, p] of Object.entries(prev.postings)) {
    if (found[id]) continue;
    const filledDate = p.last_filled || today;
    if (daysBetween(filledDate, today) <= 7) {
      merged[id] = { ...p, last_filled: filledDate };
    }
  }
  Object.assign(merged, found);

  const totalBoards = GREENHOUSE_TOKENS.length + ASHBY_TOKENS.length + LEVER_TOKENS.length + SMARTRECRUITERS_TOKENS.length;
  const next = { last_scan: today, last_scan_at: new Date().toISOString(), postings: merged, scan_meta: { okCount, failCount, totalBoards } };

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
      const auth = url.searchParams.get("key");
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
