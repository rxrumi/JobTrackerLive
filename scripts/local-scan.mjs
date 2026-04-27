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

const SCANNERS = [
  { company: "zendesk",   run: () => scanWorkday("zendesk",   "zendesk.wd1.myworkdayjobs.com",   "Zendesk") }
  // Add more here as you discover working endpoints. Examples to try later:
  //   atlassian, shopify, klarna, box, monday, hashicorp (now IBM)
  //   personio (BambooHR), templafy/unbabel (Teamtailor), monday (Pinpoint)
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
