# JobTrackerLive — Handoff

JobTrackerLive is a Cloudflare Worker that hosts a personal job-search tracker for visa-sponsoring RevOps, BizOps, Sales Ops, Marketing Ops, and GTM Ops roles abroad.

The project is now cloud-only.

## Live System

| Where | URL / Path |
|---|---|
| Repo | `https://github.com/rxrumi/JobTrackerLive` |
| Live primary | `https://resumeforjd.com` |
| Live alt | `https://www.resumeforjd.com` |
| Worker direct | `https://job-tracker.sohaibkazmi-r.workers.dev` |
| Local working copy | `/Users/kazmi/Desktop/GitRepositories/JobTrackerLive` |

## Architecture

```text
Cloudflare Worker (job-tracker)
├── fetch handler
│   ├── GET /              → public/index.html
│   ├── GET /api/jobs      → KV "jobs" key, 5-minute cache
│   └── GET /api/scan-now  → manual scan trigger, requires X-Scan-Key
└── scheduled handler
    └── runScan()          → scans public ATS APIs, filters, diffs, writes KV

KV namespace: job-tracker-state
├── state → full scan history
└── jobs  → flattened public payload consumed by the UI
```

## Scanned Sources

Cloud scan sources live in `src/worker.js`:

- `GREENHOUSE_TOKENS`
- `ASHBY_TOKENS`
- `LEVER_TOKENS`
- `SMARTRECRUITERS_TOKENS`

Each source has a fetcher that normalizes jobs to:

```js
{
  id,
  source,
  company,
  title,
  location,
  city,
  country,
  url,
  tier,
  stack_fit,
  visa,
  score,
  first_seen,
  last_seen,
  last_filled
}
```

## Filter Rules

Target cities map to 15 country codes in `CITY_TO_COUNTRY`:

`GB`, `IE`, `CA`, `AU`, `SG`, `DE`, `NL`, `CH`, `SE`, `DK`, `NO`, `ES`, `PT`, `EE`, `NZ`.

Role matching is a case-insensitive substring check against `ROLE_KEYWORDS`, including:

`revenue operations`, `revops`, `sales operations`, `marketing operations`, `business operations`, `gtm operations`, `sales strategy`, `revenue strategy`, and `strategy and operations`.

## Scan Behavior

The cron is configured in `wrangler.toml`:

```toml
[triggers]
crons = ["0 3 * * *"]
```

`runScan(env)`:

1. Reads prior KV state.
2. Fetches ATS boards in batches of 8.
3. Keeps jobs whose title and location match the configured rules.
4. Preserves `first_seen` for recurring jobs.
5. Marks missing jobs as filled for 7 days.
6. Writes `state` and `jobs` back to KV.

Failed source protection:

- Existing postings from a failed source are preserved during partial scans.
- If more than half of sources fail, the scan aborts without writing KV.
- `scan_meta` records `okSources` and `failedSources`.

Postings from retired sources are ignored during cloud scans and dropped from the regenerated payload.

## Operational Commands

```bash
npm install
npx wrangler deploy
npx wrangler tail
```

Manual scan:

```bash
curl -H "X-Scan-Key: <SCAN_KEY>" "https://job-tracker.<subdomain>.workers.dev/api/scan-now"
```

Inspect KV:

```bash
npx wrangler kv:key get jobs --binding KV
npx wrangler kv:key get state --binding KV
```

Force a clean re-scan:

```bash
npx wrangler kv:key delete state --binding KV
curl -H "X-Scan-Key: <SCAN_KEY>" "https://job-tracker.<subdomain>.workers.dev/api/scan-now"
```

## Common Changes

- Add a public ATS board: add its token to the relevant token array and deploy.
- Add a country/city: update `CITY_TO_COUNTRY` in `src/worker.js` and `COUNTRY_NAMES` / `COUNTRY_FLAGS` in `public/index.html`.
- Add a role keyword: update `ROLE_KEYWORDS`.
- Change fit/tier classification: update `HIGH_FIT_COMPANIES`, `ECOSYSTEM_COMPANIES`, or `SCALEUP_COMPANIES`.
- Change visa assumptions: update `STRONG_VISA_COMPANIES` or `LIKELY_VISA_COMPANIES`.
- Normalize a non-obvious ATS token: update `COMPANY_ALIASES`.

## Verification

```bash
npm test
npx wrangler deploy --dry-run
```

## Known Limits

- Proprietary, JS-rendered, login-gated, or bot-protected ATSs are not scanned.
- Big Tech entries are static links in `public/index.html`.
- User status and starred jobs are stored in browser `localStorage`.
- There is no secondary ingest path; all dynamic jobs come from the cloud scan.
