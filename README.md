# Job Tracker — Cloudflare deployment

Self-contained Cloudflare Worker that:
- Serves the live job-search tracker at `/`
- Exposes `/api/jobs` returning the latest dynamic postings from KV
- Runs a daily cron at `0 3 * * *` UTC that scans supported public ATS APIs
- Filters jobs by target geography and broad professional tech-company role families
- Tracks NEW and FILLED state across scans

Free tier on Cloudflare handles this volume comfortably.

## Prerequisites

- A Cloudflare account
- Node.js 18+
- Wrangler via `npm install`

KV namespace:
- Title: `job-tracker-state`
- ID: `8cf95c7c04054745bff09d88ea57d707`

The namespace is already wired into `wrangler.toml`.

## Deploy

```bash
npm install
npx wrangler login
npx wrangler deploy
```

The CLI prints the live Worker URL. The custom domains are configured in `wrangler.toml`.

## Trigger a scan manually

```bash
npx wrangler secret put SCAN_KEY
curl -H "X-Scan-Key: <your-secret>" "https://job-tracker.<your-subdomain>.workers.dev/api/scan-now"
```

Response shape:

```json
{ "okCount": 40, "failCount": 0, "total": 26 }
```

## How the cron works

`wrangler.toml` declares:

```toml
[triggers]
crons = ["0 3 * * *"]
```

The Worker's `scheduled()` handler calls `runScan(env)`. The scan fetches public job-board APIs in batches of 8, filters matching postings, diffs against KV state, and writes:

- `state` — full posting history with `first_seen`, `last_seen`, and `last_filled`
- `jobs` — flattened public payload consumed by `/api/jobs`

If a source fails during a partial scan, existing postings from that source are preserved instead of being marked filled. If more than half of sources fail, the scan aborts without writing KV.

Currently scanned ATS sources:
- Greenhouse
- Ashby
- Lever
- SmartRecruiters

Filled postings are retained for 7 days after disappearing from their source feed, then pruned.

Manual scans require `X-Scan-Key`; query-string scan keys are not accepted.

## Inspecting and debugging

```bash
# Live tail Worker logs
npx wrangler tail

# Read KV directly
npx wrangler kv:key get jobs --binding KV
npx wrangler kv:key get state --binding KV

# Force-clear and re-scan from scratch
npx wrangler kv:key delete state --binding KV
curl -H "X-Scan-Key: <your-secret>" "https://<url>/api/scan-now"
```

## Files

```text
.
├── wrangler.toml         # Worker config, KV binding, cron, static assets
├── src/worker.js         # HTTP routes, scheduled handler, scan logic
├── public/index.html     # Tracker UI
├── test/worker.test.mjs  # Scan behavior tests
├── package.json          # Wrangler dependency/scripts
└── README.md
```

## Modifying tracking rules

Edit `src/worker.js`:

- `GREENHOUSE_TOKENS`, `ASHBY_TOKENS`, `LEVER_TOKENS`, `SMARTRECRUITERS_TOKENS` — add or remove scanned boards
- `CITY_TO_COUNTRY` — add cities/geographies
- `ROLE_FAMILIES` — adjust title matching and role-family classification
- `SCALEUP_COMPANIES` — companies classified as scale-ups
- `STRONG_VISA_COMPANIES`, `LIKELY_VISA_COMPANIES` — dynamic visa scoring assumptions
- `COMPANY_ALIASES` — maps non-obvious ATS tokens to display/classification names

Run `npx wrangler deploy` to push changes.

## Tests

```bash
npm test
npx wrangler deploy --dry-run
```

## Known limits

- Big Tech ATS scraping is not implemented. Static entries link to filtered careers-search URLs.
- Status workflow lives in browser `localStorage`, so it is per-device.
- Some ATSs that require browser sessions, API keys, or bot-challenge bypass are intentionally not scanned.
