# JobTrackerLive — Codex context

A Cloudflare Worker that hosts a personal job-search tracker for visa-sponsoring RevOps / BizOps / Sales-Ops / Marketing-Ops roles abroad. Runs a daily cloud scan of supported public ATS APIs, diffs against KV state, and serves a static HTML UI that merges curated entries with the dynamic feed.

Built for **Sohaib "King" Kazmi** — Dubai-based BizOps Manager / RevOps consultant looking to relocate. Stack: HubSpot, Clay, GoHighLevel, n8n, Make.

## Architecture at a glance

```
Cloudflare Worker (job-tracker)
├── fetch handler
│   ├── GET /              → public/index.html (static asset)
│   ├── GET /api/jobs      → KV "jobs" key (300s cache)
│   └── GET /api/scan-now  → manual scan trigger (requires X-Scan-Key)
└── scheduled handler (cron: 0 3 * * * UTC)
    └── runScan() → fetches public ATS boards in batches of 8 → filters → KV write

KV namespace: job-tracker-state (id 8cf95c7c04054745bff09d88ea57d707)
├── "state"  → { last_scan, postings: { [id]: { first_seen, last_seen, last_filled? } } }
└── "jobs"   → flattened public payload (what /api/jobs returns)
```

The local scanner has been removed. The app is cloud-only. On load, `public/index.html` fetches `/api/jobs` and merges dynamic postings on top of the curated static entries, with `NEW` (≤ 7d since first_seen) and `FILLED` (no longer listed) badges.

## Files

- `wrangler.toml` — Worker config: KV binding, cron trigger, static asset binding
- `src/worker.js` — fetch + scheduled handlers, scan logic, country/keyword matching, scoring
- `public/index.html` — self-contained tracker UI (HTML + CSS + JS in one file)
- `package.json` — wrangler dev dependency and test script
- `test/worker.test.mjs` — scan behavior tests
- `README.md` — deploy instructions

## Target geography

15 countries: GB, IE, CA, AU, SG, DE, NL, CH, SE, DK, NO, ES, PT, EE, NZ.
City matching is in `CITY_TO_COUNTRY` in `src/worker.js`.

## Role keywords

`revenue operations`, `revops`, `sales operations`, `marketing operations`, `business operations`, `gtm operations`, `field operations`, `sales strategy`, `revenue strategy`, `sales excellence`, `strategy and operations`. Case-insensitive substring match in job title.

## Companies tracked dynamically

Token arrays in `src/worker.js`: `GREENHOUSE_TOKENS`, `ASHBY_TOKENS`, `LEVER_TOKENS`, `SMARTRECRUITERS_TOKENS`.
Greenhouse endpoint pattern: `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=false`

High-fit (stack matches HubSpot/Clay/Pipedrive ecosystem): hubspot, gongio, klaviyo, pleo, personio, typeform, factorialhr, talkdesk, mollie, pipedrive, mentimeter, deel, kahoot, notion, xero, trustpilot, miro.

## Companies in the static list but NOT auto-scanned

Big Tech with proprietary ATS (Google, Meta, Microsoft, AWS, Salesforce, Stripe, ServiceNow, Adobe, etc.). These are static "go check the careers page" entries — the careers URLs in `STATIC_JOBS` are filtered search pages.

## Scoring

`score = round(fitW * 0.4 + visaW * 0.4 + 85 * 0.2)` where
- `fitW` = `{High:100, Med:70, Low:40}`
- `visaW` = `{Strong:100, Likely:75, Unknown:50}`

Logic lives in both `src/worker.js` (for dynamic) and `public/index.html` (for static, identical formula).

## Deploy

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Then provision the manual-scan secret and trigger the first scan:

```bash
npx wrangler secret put SCAN_KEY
# paste any random string
curl -H "X-Scan-Key: <your-secret>" "https://job-tracker.<subdomain>.workers.dev/api/scan-now"
```

## Common follow-ups

- **Add a new company to track**: append its ATS token to the relevant token array in `src/worker.js`. If it should be high-fit, also add to `HIGH_FIT_COMPANIES`. If it's a scale-up, add to `SCALEUP_COMPANIES`. Use `COMPANY_ALIASES` for non-obvious ATS tokens. `npx wrangler deploy` to push.
- **Add a new country**: extend `CITY_TO_COUNTRY` (worker.js) AND `COUNTRY_NAMES` + `COUNTRY_FLAGS` in `public/index.html`. Push.
- **Add a new role keyword**: extend `ROLE_KEYWORDS` in `src/worker.js`.
- **Sync status across devices**: build a `POST /api/status` endpoint that writes to KV, keyed by a session cookie. Replace the localStorage calls in `public/index.html` with fetches to `/api/status`. ~30 lines of code.
- **Email digest on new postings**: in `runScan()`, after KV write, count entries where `first_seen === today` and post to a Resend / Mailchannels endpoint if count > 0.
- **Debug a specific board**: `curl "https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=false" | jq '.jobs[] | {title, location: .location.name}'`
- **Force a clean re-scan**: `npx wrangler kv:key delete state --binding KV` then hit `/api/scan-now` with `X-Scan-Key`.

## Known limits

- `node_modules/` and `package-lock.json` are gitignored — run `npm install` after cloning.
- Proprietary, JS-rendered, login-gated, or bot-protected ATSs are not scanned. Static entries link to filtered careers-search URLs.
- Status workflow (Saved → Applied → Interview) lives in browser localStorage, so it's per-device. See "Sync status across devices" above.
- Cloudflare Worker free tier covers all expected volume (< 100 requests/day, < 200 KV ops/day) at $0/month.

## Verification

```bash
npm test
npx wrangler deploy --dry-run
```
