# JobTrackerLive — Claude Code context

A Cloudflare Worker that hosts a personal job-search tracker for visa-sponsoring RevOps / BizOps / Sales-Ops / Marketing-Ops roles abroad. Runs a daily cloud scan of supported public ATS APIs, diffs against KV state, and serves a static HTML UI that merges curated entries with the dynamic feed.

Built for **Sohaib "King" Kazmi** — Dubai-based BizOps Manager / RevOps consultant looking to relocate. Stack: HubSpot, Clay, GoHighLevel, n8n, Make.

## Architecture at a glance

```text
Cloudflare Worker (job-tracker)
├── fetch handler
│   ├── GET /              → public/index.html (static asset)
│   ├── GET /api/jobs      → KV "jobs" key (300s cache)
│   └── GET /api/scan-now  → manual scan trigger (requires X-Scan-Key)
└── scheduled handler (cron: 0 3 * * * UTC)
    └── runScan() → fetches public ATS boards in batches of 8 → filters → KV write

KV namespace: job-tracker-state
├── "state"  → { last_scan, postings: { [id]: { first_seen, last_seen, last_filled? } } }
└── "jobs"   → flattened public payload (what /api/jobs returns)
```

The local scanner has been removed. The app is cloud-only.

## Files

- `wrangler.toml` — Worker config: KV binding, cron trigger, static asset binding
- `src/worker.js` — fetch + scheduled handlers, scan logic, country/keyword matching, scoring
- `public/index.html` — self-contained tracker UI (HTML + CSS + JS in one file)
- `package.json` — wrangler dev dependency
- `README.md` — deploy instructions
- `HANDOFF.md` — operational context

## Target geography

15 countries: GB, IE, CA, AU, SG, DE, NL, CH, SE, DK, NO, ES, PT, EE, NZ.
City matching is in `CITY_TO_COUNTRY` in `src/worker.js`.

## Role keywords

`revenue operations`, `revops`, `sales operations`, `marketing operations`, `business operations`, `gtm operations`, `field operations`, `sales strategy`, `revenue strategy`, `sales excellence`, `strategy and operations`. Case-insensitive substring match in job title.

## Dynamic scan sources

Source token arrays live in `src/worker.js`:

- `GREENHOUSE_TOKENS`
- `ASHBY_TOKENS`
- `LEVER_TOKENS`
- `SMARTRECRUITERS_TOKENS`

Each source is normalized into the common posting shape and written to KV.

## Companies in the static list but NOT auto-scanned

Big Tech and proprietary ATS companies are static "go check the careers page" entries. Their careers URLs in `STATIC_JOBS` are filtered search pages.

## Scoring

`score = round(fitW * 0.4 + visaW * 0.4 + 85 * 0.2)` where:

- `fitW` = `{High:100, Med:70, Low:40}`
- `visaW` = `{Strong:100, Likely:75, Unknown:50}`

Logic lives in both `src/worker.js` for dynamic jobs and `public/index.html` for static jobs.

## Deploy

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Then provision the manual-scan secret and trigger the first scan:

```bash
npx wrangler secret put SCAN_KEY
curl -H "X-Scan-Key: <your-secret>" "https://job-tracker.<subdomain>.workers.dev/api/scan-now"
```

## Common follow-ups

- **Add a new company to track**: add its ATS token to the matching token array in `src/worker.js`, then deploy.
- **Add a new country**: extend `CITY_TO_COUNTRY` in `src/worker.js` and `COUNTRY_NAMES` / `COUNTRY_FLAGS` in `public/index.html`.
- **Add a new role keyword**: extend `ROLE_KEYWORDS` in `src/worker.js`.
- **Change visa assumptions**: update `STRONG_VISA_COMPANIES` or `LIKELY_VISA_COMPANIES`.
- **Normalize ATS token names**: update `COMPANY_ALIASES`.
- **Sync status across devices**: build a `POST /api/status` endpoint that writes to KV, keyed by a session cookie. Replace localStorage calls in `public/index.html` with fetches to `/api/status`.
- **Email digest on new postings**: in `runScan()`, after KV write, count entries where `first_seen === today` and post to a Resend / MailChannels endpoint if count > 0.
- **Debug a specific Greenhouse board**: `curl "https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=false" | jq '.jobs[] | {title, location: .location.name}'`
- **Force a clean re-scan**: `npx wrangler kv:key delete state --binding KV` then hit `/api/scan-now`.

## Verification

```bash
npm test
npx wrangler deploy --dry-run
```

## Known limits

- `node_modules/` and `package-lock.json` are gitignored.
- Proprietary, JS-rendered, login-gated, or bot-protected ATSs are not scanned.
- Status workflow lives in browser `localStorage`, so it is per-device.
- Cloudflare Worker free tier covers expected personal usage.
