# JobTrackerLive — Handoff

You are picking up a partly-built personal job-search tracker. The cloud scanning pipeline is shipping daily. Your job is to extend the **local scanner** with new company-specific fetchers for ~18 remaining ATSs that need browser-realistic IPs, session cookies, or auth that Cloudflare Workers can't supply.

## Owner

**Sohaib "King" Kazmi** — Dubai-based BizOps Manager / RevOps consultant looking to relocate to a visa-sponsoring country. Stack: HubSpot, Clay, GoHighLevel, n8n, Make. Target seniority: Lead / Manager / Senior IC.

## Live system

| Where | URL / Path |
|---|---|
| Repo | https://github.com/rxrumi/JobTrackerLive |
| Live primary | https://resumeforjd.com |
| Live alt | https://www.resumeforjd.com |
| Worker direct | https://job-tracker.sohaibkazmi-r.workers.dev |
| Local working copy | `/Users/kazmi/Desktop/GitRepositories/JobTrackerLive` |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker  (job-tracker)                           │
│  ─────────────────                                          │
│  GET   /                  → public/index.html (95 static)   │
│  GET   /api/jobs          → KV "jobs" key (5-min cached)    │
│  GET   /api/scan-now?key= → manual cloud scan trigger       │
│  POST  /api/local-jobs    → accept scraped jobs from Mac    │
│  Cron  0 3 * * * UTC      → daily cloud scan (07:00 Dubai)  │
│                                                             │
│  KV namespace: 8cf95c7c04054745bff09d88ea57d707             │
│    "state" → { postings: { [id]: {...} } }                  │
│    "jobs"  → flat public payload                            │
└─────────────────────────────────────────────────────────────┘
       ▲                                          ▲
       │ daily cron                               │ POST results
       │                                          │
┌──────┴────────────────┐         ┌───────────────┴──────────┐
│  Cloud scanners       │         │  Local scanner (Mac)     │
│  ────────────────     │         │  ─────────────────       │
│  Greenhouse  (27)     │         │  scripts/local-scan.mjs  │
│  Ashby       (8)      │         │                          │
│  Lever       (1)      │         │  Currently 1 scanner:    │
│  SmartRecruit (2)     │         │  - Zendesk (Workday) ✓   │
│                       │         │                          │
│  Total:  38 boards    │         │  Needs ~18 more (below)  │
│  Yield:  26 postings  │         │                          │
└───────────────────────┘         └──────────────────────────┘
```

**Key invariant:** cloud and local scans never overwrite each other. The cloud cron only manages postings tagged `source: greenhouse | ashby | lever | smartrecruiters`. The local script only manages `source: "local"`. An empty `POST /api/local-jobs` clears all local postings; cloud postings stay untouched.

## Secrets / IDs

| Key | Value |
|---|---|
| `SCAN_KEY` | `fa83ff438f69fe61efbdbc4ad0fad208` (used for both `/api/scan-now` and `/api/local-jobs`) |
| `CLOUDFLARE_API_TOKEN` | Stored in GitHub Secrets, used by `.github/workflows/deploy.yml` |
| Cloudflare account ID | `c0cf7c4ffa0f725dd4c485a5c9032f7e` |
| `resumeforjd.com` zone ID | `26201f140ccd499dca6a53206fe8e253` |
| KV namespace ID | `8cf95c7c04054745bff09d88ea57d707` |

## Filter rules (already implemented — your scanners don't enforce these, the main loop does)

**Target cities** → 15 country codes:
London / Manchester / Edinburgh → GB · Dublin / Cork → IE · Toronto / Vancouver / Montreal → CA · Sydney / Melbourne → AU · Singapore → SG · Berlin / Munich / Hamburg / Frankfurt → DE · Amsterdam / Rotterdam → NL · Zurich / Geneva → CH · Stockholm → SE · Copenhagen / Aarhus → DK · Oslo → NO · Barcelona / Madrid → ES · Lisbon / Porto → PT · Tallinn → EE · Auckland / Wellington → NZ

**Role keywords** (case-insensitive substring match in title):
`revenue operations`, `revops`, `rev ops`, `sales operations`, `sales ops`, `marketing operations`, `marketing ops`, `business operations`, `biz ops`, `gtm operations`, `gtm ops`, `go-to-market operations`, `field operations`, `sales strategy`, `revenue strategy`, `sales excellence`, `strategy and operations`, `strategy & operations`

These live in `local-scan.mjs` as `TARGET_COUNTRIES`, `ROLE_KEYWORDS`, `matchCountry()`, `matchKeywords()`. Your scanners return raw jobs; the main loop filters.

## Worker code structure (`src/worker.js`)

| Lines | Section |
|---|---|
| 1–26 | Token lists (`GREENHOUSE_TOKENS`, `ASHBY_TOKENS`, `LEVER_TOKENS`, `SMARTRECRUITERS_TOKENS`) |
| 28–82 | Matching helpers (`CITY_TO_COUNTRY`, `ROLE_KEYWORDS`, `matchCountry`, `matchKeywords`, `classifyTier`, `classifyFit`, `calcScore`) |
| 113–192 | Per-ATS fetchers (`fetchGreenhouse`, `fetchAshby`, `fetchLever`, `fetchSmartRecruiters`) |
| 193–272 | `runScan(env)` — cloud cron handler. **Preserves `source: "local"` postings on prune.** |
| 274–334 | `mergeLocalJobs(env, jobs)` — handles `POST /api/local-jobs` |
| 336–end | HTTP router + `scheduled` handler |

## Local scanner — what's there

Single file: `scripts/local-scan.mjs`. One working scanner: **Zendesk** via Workday (`zendesk.wd1.myworkdayjobs.com/Zendesk`). Pulls 209 jobs total, filtered down by role keywords + 15 target cities. Genuinely 0 matches today — Zendesk has no open RevOps in target geos right now, but it'll catch them when one opens.

Run it locally:

```bash
cd /Users/kazmi/Desktop/GitRepositories/JobTrackerLive
SCAN_KEY=fa83ff438f69fe61efbdbc4ad0fad208 node scripts/local-scan.mjs
```

Expected output: one `companyname: N total → M matching` line per scanner. POST to `/api/local-jobs` happens automatically if any matches.

**Workday gotcha (already handled, don't break it):** max `limit` is 20 per page. `data.total` is only returned on the first page; page 2+ returns `total = 0`. The current scanner handles this correctly with a running offset and a stop condition based on results returned.

## YOUR JOB — extend the local scanner with these 18 companies

| Company | Likely ATS | Notes | Priority |
|---|---|---|---|
| **Personio** | Personio's own / BambooHR (XML feed?) | Munich/Berlin · HubSpot-heavy SaaS | ⭐ HIGH FIT |
| **Factorial** | BambooHR | Barcelona · HubSpot-heavy SaaS | ⭐ HIGH FIT |
| **Kahoot!** | Custom | Oslo · EdTech B2B | ⭐ HIGH FIT |
| **Talkdesk** | Custom | Lisbon · CCaaS unicorn | ⭐ HIGH FIT |
| **Atlassian** | Workday — `atlassian.wd3.myworkdayjobs.com/Atlassian` (returns 422 from curl, may need session cookie) | Sydney/UK/IE · top sponsor | High |
| **Klarna** | Workday (tenant unknown — investigate) | Stockholm · 90+ nationalities | High |
| **Shopify** | Ashby (token unknown — search careers page DOM) | Canada · GTS sponsor | High |
| **Templafy** | Teamtailor (`templafy.teamtailor.com` — public JSON 404s, needs API key) | Copenhagen | Med |
| **Unbabel** | Teamtailor | Lisbon | Med |
| **Miro** | Custom JS-rendered SPA | Amsterdam | Med |
| **OutSystems** | Custom | Lisbon | Med |
| **TravelPerk** | Custom | Barcelona | Med |
| **Bolt** | Custom | Tallinn | Med |
| **Glovo** | Custom | Barcelona | Med |
| **Monday.com** | Pinpoint (`*.pinpointhq.com` — likely needs API key) | — | Med |
| **Box** | Workday | — | Low |
| **Zendesk** | Workday `zendesk.wd1.myworkdayjobs.com/Zendesk` | — | ✅ DONE |
| **HashiCorp** | Now on IBM careers (acquired 2025) | — | ❌ SKIP |

**Recommended order:** Personio → Factorial → Kahoot! → Talkdesk (all ⭐ — most signal for the owner), then Atlassian → Klarna → Shopify (top visa sponsors), then the rest opportunistically.

## How to add a scanner

For each company:

### 1. Find the actual API
- Open the careers page in Chrome
- DevTools → **Network** tab → filter `fetch/xhr`
- Reload, search for jobs in their UI → look for the JSON request that returns the listings
- Note the **URL**, **method**, **headers**, **body**

### 2. Add a scanner function in `scripts/local-scan.mjs` next to `scanWorkday`

```js
async function scanXYZ(company, ...args) {
  const r = await fetch(url, {
    method: "POST" /* or "GET" */,
    headers: { /* ... */ },
    body: /* ... */
  });
  if (!r.ok) throw new Error(`${company}: HTTP ${r.status}`);
  const data = await r.json();
  return (data.jobs || []).map(j => ({
    id:       j.id || j.uniqueId,
    title:    j.title,
    location: j.location || j.city,
    url:      j.applyUrl || `https://example.com${j.path}`
  }));
}
```

### 3. Register it in the `SCANNERS` array

```js
{ company: "atlassian",
  run: () => scanWorkday("atlassian", "atlassian.wd3.myworkdayjobs.com", "Atlassian") }
```

(For Workday, just discover the host + site and reuse the existing `scanWorkday` function — don't write a new one.)

### 4. Test locally

```bash
SCAN_KEY=fa83ff438f69fe61efbdbc4ad0fad208 node scripts/local-scan.mjs
```

Pass criteria:
- Console prints `companyname: N total → M matching` (N > 0)
- No thrown errors
- If `M > 0`, postings appear at https://resumeforjd.com after the run completes

### 5. Commit + push

GitHub Actions auto-deploys the Worker if you touch `src/worker.js`. The local scanner script doesn't need a deploy — it runs on the Mac.

## Definition of done (per scanner)

- [ ] Returns ≥ 1 raw job from the source ATS
- [ ] Maps correctly to `{ id, title, location, url }` shape
- [ ] No 4xx/5xx errors when run cold (no cookies primed)
- [ ] Registered in `SCANNERS` array
- [ ] At least one test run completes without hanging
- [ ] Committed to repo with a clear commit message naming the company

## Daily schedule (set this up after at least 4 scanners are working)

Two options — pick one:

### Option A — system cron (simplest)

```bash
crontab -e
```

```
# 05:00 Dubai daily — runs local scanner 1 hour before cloud cron
0 5 * * * cd ~/Desktop/GitRepositories/JobTrackerLive && SCAN_KEY=fa83ff438f69fe61efbdbc4ad0fad208 node scripts/local-scan.mjs >> /tmp/jobtracker.log 2>&1
```

### Option B — Cowork scheduled task

Create a routine in Cowork that runs the same shell command at 05:00 Dubai daily.

## What NOT to touch

- ❌ The cloud-side fetchers (Greenhouse / Ashby / Lever / SmartRecruiters) — they work, leave them alone
- ❌ The 95 static entries in `public/index.html` — hand-curated, keep them
- ❌ The custom domain config in `wrangler.toml` — already deployed
- ❌ The KV namespace — don't recreate it; it has live data
- ❌ The Workday pagination logic in `scanWorkday` — it handles the `total = 0 on page 2+` edge case correctly

## Quick verification after each new scanner

```bash
# 1. Run the scanner end-to-end
SCAN_KEY=fa83ff438f69fe61efbdbc4ad0fad208 node scripts/local-scan.mjs

# 2. Confirm the POST hit
curl -s https://resumeforjd.com/api/jobs | jq '.postings | map(select(.source == "local")) | length'

# 3. Visual check
open https://resumeforjd.com
# scroll for new postings — they show up just like cloud postings (no special UI badge yet)
```

## Stretch goals (if time permits)

- Add a `source: "local"` visual badge in `public/index.html` so the owner can tell which postings came from which pipeline
- Build a `/api/companies` admin endpoint so new ATS tokens can be registered via curl without redeploying
- Email digest on days with 3+ new postings (Resend or MailChannels)

---

**Repo:** https://github.com/rxrumi/JobTrackerLive · **Live:** https://resumeforjd.com
