# JobTrackerLive — Handoff

JobTrackerLive is a Cloudflare Worker that hosts a personal, visa-aware technology job tracker for relocation markets. It scans supported public ATS APIs, keeps historical state in KV, and serves a static UI for live jobs, curated targets, pipeline status, and archived/filled roles.

The project is cloud-only.

## Live System

| Where | URL / Path |
|---|---|
| Repo | `https://github.com/rxrumi/JobTrackerLive` |
| Live primary | `https://livejobindex.com` |
| Live alt | `https://www.livejobindex.com` |
| Worker direct | Disabled in production (`workers_dev = false`) |
| Local working copy | `/Users/kazmi/Desktop/GitRepositories/JobTrackerLive` |

## Architecture

```text
Cloudflare Worker (job-tracker)
├── fetch handler
│   ├── GET /              -> public/index.html
│   ├── GET /api/jobs      -> KV "jobs" key, 5-minute cache
│   └── GET /api/scan-now  -> manual scan trigger, requires X-Scan-Key
└── scheduled handler
    └── runScan()          -> scans public ATS APIs, filters, diffs, writes KV

KV namespace: job-tracker-state
├── state -> full scan history
└── jobs  -> flattened public payload consumed by the UI
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
  source_token,
  company,
  title,
  location,
  city,
  country,
  url,
  tier,
  role_family,
  seniority,
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

Country-level fallback matching lives in `COUNTRY_HINTS`.

Role matching is title-based and uses `ROLE_FAMILIES`, `ROLE_FALLBACK_KEYWORDS`, and `EXCLUDED_TITLE_KEYWORDS`. The scope is broad professional tech roles: Engineering, Product, Design, Data/Analytics, Security/IT, Sales, Marketing, Finance, Operations, Customer Success/Support, People/HR, Legal/Compliance, Strategy/Program, and Other.

Seniority is inferred from title text by `classifySeniority()`.

## Scoring

Current formula:

```js
score = round(visa * 0.5 + seniority * 0.3 + freshness * 0.2)
```

Keep `calcScore()` aligned in both `src/worker.js` and `public/index.html`.

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
curl -H "X-Scan-Key: <SCAN_KEY>" "https://livejobindex.com/api/scan-now"
```

Inspect KV:

```bash
npx wrangler kv:key get jobs --binding KV
npx wrangler kv:key get state --binding KV
```

Force a clean re-scan:

```bash
npx wrangler kv:key delete state --binding KV
curl -H "X-Scan-Key: <SCAN_KEY>" "https://livejobindex.com/api/scan-now"
```

## Common Changes

- Add a public ATS board: add its token to the relevant token array and deploy.
- Add a static target: add a company-location entry to `STATIC_COMPANIES` in `public/index.html`.
- Add a country/city: update `CITY_TO_COUNTRY` / `COUNTRY_HINTS` in `src/worker.js` and `COUNTRY_NAMES` / `COUNTRY_FLAGS` in `public/index.html`.
- Change role matching: update `ROLE_FAMILIES`, `ROLE_FALLBACK_KEYWORDS`, or `EXCLUDED_TITLE_KEYWORDS`; mirror display fallback changes in `public/index.html` if needed.
- Change tier classification: update `HIGH_FIT_COMPANIES`, `ECOSYSTEM_COMPANIES`, or `SCALEUP_COMPANIES`.
- Change visa assumptions: update `STRONG_VISA_COMPANIES` or `LIKELY_VISA_COMPANIES`.
- Normalize a non-obvious ATS token: update `COMPANY_ALIASES`.
- Change scoring: update `calcScore()` in both `src/worker.js` and `public/index.html`.

## Verification

```bash
npm test
npx wrangler deploy --dry-run
```

## Known Limits

- Proprietary, JS-rendered, login-gated, or bot-protected ATSs are not scanned.
- Static target entries are not live postings.
- Role matching is title-based; job descriptions are not fetched.
- Visa classification is heuristic and company-level.
- User status and starred jobs are stored in browser `localStorage`.
- There is no email digest or server-side status sync yet.
