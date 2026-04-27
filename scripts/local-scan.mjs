#!/usr/bin/env node
// Local scanner — runs from your Mac, hits careers APIs that block Cloudflare Worker IPs
// (Workday CSRF, Teamtailor, etc.), and POSTs results to the live Worker.
//
// Usage:  SCAN_KEY=xxxx node scripts/local-scan.mjs
// Or set SCAN_KEY in ~/.config/jobtracker.env

const ENDPOINT = process.env.JOB_TRACKER_URL || "https://resumeforjd.com/api/local-jobs";
const SCAN_KEY = process.env.SCAN_KEY;
if (!SCAN_KEY) {
  console.error("ERROR: SCAN_KEY env var required");
  process.exit(1);
}

const TARGET_COUNTRIES = {
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

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function matchCountry(loc) {
  if (!loc) return null;
  for (const [city, country] of Object.entries(TARGET_COUNTRIES)) {
    if (loc.includes(city)) return { city, country };
  }
  return null;
}

function matchKeywords(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  return ROLE_KEYWORDS.some(k => t.includes(k));
}

// =============================================================================
// SCANNERS — one per company. Each returns { company, jobs: [{id,title,location,url}] }
// Add more by following the Workday template. Each scanner runs independently;
// failures don't stop the rest.
// =============================================================================

async function scanWorkday(company, host, site) {
  const url = `https://${host}/wday/cxs/${host.split(".")[0]}/${site}/jobs`;
  const all = [];
  let offset = 0;
  let total = Infinity;
  for (let page = 0; page < 50; page++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "" })
    });
    if (!r.ok) {
      if (page === 0) throw new Error(`${company}: HTTP ${r.status}`);
      break;
    }
    const data = await r.json();
    if (page === 0 && typeof data.total === "number") total = data.total;
    const postings = data.jobPostings || [];
    for (const j of postings) {
      all.push({
        id: j.bulletFields?.[0] || j.externalPath?.split("/").pop(),
        title: j.title,
        location: j.locationsText,
        url: `https://${host}${j.externalPath || ""}`
      });
    }
    offset += postings.length;
    if (postings.length < 20 || offset >= total) break;
  }
  return all;
}

// Greenhouse public job board API. Token is the board name in
// https://boards-api.greenhouse.io/v1/boards/<token>/jobs
// Many companies use a non-obvious token (e.g. Talkdesk = "talkdesk2", Box = "boxinc").
async function scanGreenhouse(company, token) {
  const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`, {
    headers: { "Accept": "application/json", "User-Agent": UA }
  });
  if (!r.ok) throw new Error(`${company}: HTTP ${r.status}`);
  const data = await r.json();
  return (data.jobs || []).map(j => ({
    id: String(j.id),
    title: j.title,
    location: j.location?.name || "",
    url: j.absolute_url
  }));
}

// Personio's "workzag" XML feed — every Personio careers tenant exposes a /xml endpoint.
// Format: <workzag-jobs><position><id>..</id><name>..</name><office>..</office>
//          <additionalOffices><office>..</office></additionalOffices>...</position>...
async function scanPersonioXml(company, host) {
  const r = await fetch(`https://${host}/xml`, {
    headers: { "Accept": "application/xml,text/xml", "User-Agent": UA }
  });
  if (!r.ok) throw new Error(`${company}: HTTP ${r.status}`);
  const xml = await r.text();
  const out = [];
  const positions = xml.match(/<position>[\s\S]*?<\/position>/g) || [];
  for (const block of positions) {
    const id = (block.match(/<id>(\d+)<\/id>/) || [])[1];
    // <name> appears multiple times (jobDescription children also use it). The first
    // occurrence at top level is the position title.
    const nameMatch = block.match(/<\/?subcompany>[\s\S]*?<\/subcompany>\s*<office>[\s\S]*?<\/office>(?:\s*<additionalOffices>[\s\S]*?<\/additionalOffices>)?\s*<department>[\s\S]*?<\/department>\s*<recruitingCategory>[\s\S]*?<\/recruitingCategory>\s*<name>([^<]+)<\/name>/);
    const title = nameMatch ? decodeXml(nameMatch[1]) : decodeXml((block.match(/<name>([^<]+)<\/name>/) || [])[1] || "");
    const mainOffice = (block.match(/<office>([^<]+)<\/office>/) || [])[1] || "";
    const addOffices = [...block.matchAll(/<additionalOffices>([\s\S]*?)<\/additionalOffices>/g)]
      .flatMap(m => [...m[1].matchAll(/<office>([^<]+)<\/office>/g)].map(x => x[1]));
    const allOffices = [mainOffice, ...addOffices].filter(Boolean).join(", ");
    if (!id || !title) continue;
    out.push({
      id,
      title,
      location: allOffices,
      url: `https://${host}/job/${id}`
    });
  }
  return out;
}

function decodeXml(s) {
  return (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Comeet careers API. Companies embed a widget on their careers page that exposes
// company id + token in the script src. Monday.com is on Comeet (token mined from
// monday.com/careers DOM).
async function scanComeet(company, companyId, token) {
  const url = `https://www.comeet.co/careers-api/2.0/company/${companyId}/positions?token=${token}&details=true`;
  const r = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": UA } });
  if (!r.ok) throw new Error(`${company}: HTTP ${r.status}`);
  const data = await r.json();
  return (Array.isArray(data) ? data : []).map(p => ({
    id: p.uid || p.internal_use_custom_id,
    title: p.name,
    location: p.location?.city
      ? `${p.location.city}${p.location.country ? `, ${p.location.country}` : ""}`
      : (p.location?.name || ""),
    url: p.url_active_page || p.url_comeet_hosted_page || p.url_recruit_hosted_page
  }));
}

// TravelPerk (now perk.com) embeds its full job list as inline JSON in the careers page.
// Each job shape: { id, title, url, office: { id, name } } where office.name is a city/country.
async function scanPerkInline(company) {
  const r = await fetch("https://www.perk.com/careers/", {
    headers: { "User-Agent": UA, "Accept": "text/html" }
  });
  if (!r.ok) throw new Error(`${company}: HTTP ${r.status}`);
  const html = await r.text();
  const seen = new Set();
  const out = [];
  // Walk every "jobs":[...] occurrence; brace-match to extract a balanced array.
  const re = /"jobs":\[/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const start = m.index + m[0].length - 1; // pos of [
    let depth = 0, i = start, inStr = false, esc = false;
    for (; i < html.length; i++) {
      const c = html[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) break; }
    }
    let arr;
    try { arr = JSON.parse(html.slice(start, i + 1)); } catch { continue; }
    for (const j of arr) {
      if (!j || typeof j !== "object" || !j.id || seen.has(j.id)) continue;
      seen.add(j.id);
      const office = j.office?.name || "";
      const url = j.url?.startsWith("http") ? j.url : `https://www.perk.com${j.url || ""}`;
      out.push({ id: j.id, title: j.title, location: office, url });
    }
  }
  return out;
}

// Factorial publishes its full job list server-rendered on careers.factorialhr.com.
// Each <li class='job-offer-item'> exposes data-job-postings-url, data-is-remote,
// and contains the title + team in inner text. Locations are NOT structured —
// Factorial is Barcelona-based and most roles are in Barcelona, so we surface
// "Barcelona, ES" when the listing isn't marked remote and let the title carry
// any other city signal.
async function scanFactorial(company) {
  const r = await fetch("https://careers.factorialhr.com/", {
    headers: { "User-Agent": UA, "Accept": "text/html" }
  });
  if (!r.ok) throw new Error(`${company}: HTTP ${r.status}`);
  const html = await r.text();
  const out = [];
  const re = /<li class=['"]job-offer-item[^>]*?data-job-postings-url=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    const block = m[2];
    const isRemote = /data-is-remote=['"]true['"]/.test(m[0]);
    // First non-empty text node inside the li is the job title.
    const text = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    // text shape: "Title Department Onsite|Remote Apply now"
    const title = text.replace(/\s+(Onsite|Remote|Hybrid).*$/i, "").trim();
    if (!title) continue;
    const id = url.split("-").pop();
    out.push({
      id,
      title,
      location: isRemote ? "Remote" : "Barcelona, Spain",
      url
    });
  }
  return out;
}

const SCANNERS = [
  // Workday tenants reachable from a residential IP
  { company: "zendesk",   run: () => scanWorkday("zendesk",   "zendesk.wd1.myworkdayjobs.com",   "Zendesk") },

  // Greenhouse boards (token discovered from each company's careers page redirect)
  { company: "talkdesk",  run: () => scanGreenhouse("talkdesk", "talkdesk2") },
  { company: "box",       run: () => scanGreenhouse("box",      "boxinc") },

  // Personio's own careers (workzag XML feed at every Personio tenant)
  { company: "personio",  run: () => scanPersonioXml("personio", "personio.jobs.personio.com") },

  // Monday.com on Comeet (company id + token mined from monday.com/careers DOM)
  { company: "monday",    run: () => scanComeet("monday", "41.00B", "14B52C52C67790D3E1296BA37C20") },

  // Custom careers pages with inline JSON (no public ATS API exposed)
  { company: "travelperk", run: () => scanPerkInline("travelperk") },
  { company: "factorial",  run: () => scanFactorial("factorial") }

  // KNOWN BLOCKED — investigated but not implementable without a real browser session:
  //   atlassian   — Workday returns 422 even with Origin/cookie headers (CSRF token gated)
  //   klarna      — Cloudflare bot challenge on www.klarna.com; their Workable account exists
  //                 (apply.workable.com/api/v1/widget/accounts/klarna) but is empty (0 jobs)
  //   bolt        — careers.bolt.eu jobs are React Server Components; no public JSON endpoint
  //   miro        — jobs.miro.com is fully client-rendered; /api/jobs returns 404
  //   glovo       — careers.glovoapp.com /api/jobs requires session cookies (returns redirect)
  //   outsystems  — careers site is gated behind Google sign-in
  //   shopify     — no Ashby token found; careers page is fully client-rendered
  //   templafy    — Teamtailor needs an API key
  //   unbabel     — Teamtailor needs an API key
  //   kahoot      — careers page is WordPress with no embedded ATS; jobs may be on LinkedIn only
];

// =============================================================================
// Main
// =============================================================================

async function main() {
  const collected = [];
  for (const { company, run } of SCANNERS) {
    try {
      const jobs = await run();
      const filtered = jobs
        .filter(j => matchCountry(j.location) && matchKeywords(j.title))
        .map(j => ({ ...j, company }));
      console.log(`  ${company}: ${jobs.length} total → ${filtered.length} matching`);
      collected.push(...filtered);
    } catch (e) {
      console.error(`  ${company}: FAILED — ${e.message}`);
    }
  }

  if (collected.length === 0) {
    console.log("No matching jobs found. Skipping POST.");
    return;
  }

  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Scan-Key": SCAN_KEY },
    body: JSON.stringify({ jobs: collected })
  });
  const result = await r.json();
  console.log(`\nPOSTed to worker: ${JSON.stringify(result)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
