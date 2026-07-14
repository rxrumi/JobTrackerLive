# JobTrackerLive — Claude Code context

A Cloudflare Worker that hosts a personal, visa-aware technology job tracker for relocation markets. It combines curated company targets with a daily cloud scan of supported public ATS APIs, diffs against KV state, and serves a static HTML UI that merges curated entries with the dynamic feed.

Built for **Sohaib "King" Kazmi** — Dubai-based BizOps Manager / RevOps consultant looking to relocate into international RevOps, BizOps, Sales Ops, Marketing Ops, GTM Ops, strategy, operations, and broader technology-company roles. Stack: HubSpot, Clay, GoHighLevel, n8n, Make.

## Architecture at a glance

```text
Cloudflare Worker (job-tracker)
├── fetch handler
│   ├── GET /              -> public/index.html (static asset)
│   ├── GET /api/jobs      -> KV "jobs" key (300s cache)
│   └── POST /api/scan-now -> manual scan shard (requires X-Scan-Key)
└── scheduled handler (five crons from 03:00-03:40 UTC)
    └── runScan({ shardIndex }) -> bounded source shard -> safe diff -> KV write

KV namespace: job-tracker-state
├── "state" -> full scan state and posting history
└── "jobs"  -> flattened public payload consumed by the UI
```

The local scanner has been removed. The app is cloud-only.

## Files

- `wrangler.toml` — Worker config: KV binding, cron trigger, static asset binding
- `src/worker.js` — fetch + scheduled handlers, ATS fetchers, country matching, role-family matching, seniority, visa, scoring
- `public/index.html` — self-contained tracker UI (HTML + CSS + JS in one file)
- `package.json` — wrangler dev dependency and test script
- `test/worker.test.mjs` — scan behavior tests
- `README.md` — full app documentation
- `HANDOFF.md` — operational context

## Target geography

26 countries: GB, IE, CA, AU, US, SG, DE, NL, CH, SE, DK, NO, ES, PT, EE, NZ, FR, IT, PL, BE, FI, AT, JP, KR, IN, TW.
City matching is in `CITY_TO_COUNTRY` and country-level fallback matching is in `COUNTRY_HINTS` in `src/worker.js`.

## Role matching

The scanner targets broad professional technology-company roles, not only RevOps/GTM Ops. Update `ROLE_FAMILIES`, `ROLE_FALLBACK_KEYWORDS`, and `EXCLUDED_TITLE_KEYWORDS` in `src/worker.js`.

Current families: Engineering, Product, Design, Data/Analytics, Security/IT, Sales, Marketing, Finance, Operations, Customer Success/Support, People/HR, Legal/Compliance, Strategy/Program, Other.

`public/index.html` has frontend fallback inference for display only. Keep `inferRoleFamily()` and `inferSeniority()` aligned when changing Worker classification.

## Dynamic scan sources

Source token arrays live in `src/worker.js`:

- `GREENHOUSE_TOKENS`
- `ASHBY_TOKENS`
- `LEVER_TOKENS`
- `SMARTRECRUITERS_TOKENS`

Each source is normalized into the common posting shape and written to KV.

## Static targets

Companies with proprietary, JS-rendered, login-gated, bot-protected, or otherwise unreliable ATS pages are static targets in `STATIC_COMPANIES` in `public/index.html`. These rows are company-location careers targets, not confirmed live postings.

## Scoring

Current formula:

```js
score = round(visa * 0.5 + seniority * 0.3 + freshness * 0.2)
```

Logic lives in both `src/worker.js` for dynamic jobs and `public/index.html` for static/frontend fallback scoring. Keep them aligned.

## Deploy

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Then provision the manual-scan secret and trigger the first scan:

```bash
npx wrangler secret put SCAN_KEY
for shard in 0 1 2 3 4; do
  curl -X POST -H "X-Scan-Key: <your-secret>" "https://livejobindex.com/api/scan-now?shard=$shard"
  [ "$shard" = 4 ] || sleep 65
done
```

## Common follow-ups

- **Add a new public ATS company**: add its ATS token to the matching token array in `src/worker.js`, then update aliases, tier sets, or visa sets if needed.
- **Add a static target**: add a company-location entry to `STATIC_COMPANIES` in `public/index.html`.
- **Add a country/city**: update `CITY_TO_COUNTRY` / `COUNTRY_HINTS` in `src/worker.js` and `COUNTRY_NAMES` / `COUNTRY_FLAGS` in `public/index.html`.
- **Change role matching**: update `ROLE_FAMILIES`, `ROLE_FALLBACK_KEYWORDS`, or `EXCLUDED_TITLE_KEYWORDS`; mirror display fallback changes in `public/index.html` if needed.
- **Change visa assumptions**: update `STRONG_VISA_COMPANIES` or `LIKELY_VISA_COMPANIES`.
- **Normalize ATS token names**: update `COMPANY_ALIASES`.
- **Email digest on new postings**: in `runScan()`, after KV write, count entries where `first_seen === today` and post to a Resend / MailChannels endpoint if count > 0.
- **Debug a specific Greenhouse board**: `curl "https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=false" | jq '.jobs[] | {title, location: .location.name}'`
- **Force a complete re-scan**: call `POST /api/scan-now?shard=0` through `?shard=4`; do not delete KV state.

## Verification

```bash
npm test
npx wrangler deploy --dry-run
```

## Known limits

- `node_modules/` is gitignored; `package-lock.json` is committed.
- Proprietary, JS-rendered, login-gated, or bot-protected ATSs are not scanned.
- Static target entries are not live postings.
- Role matching is title-based; job descriptions are not fetched.
- Visa classification is heuristic and company-level.
- Status, stars, notes, and pipeline history are stored per Clerk user in D1.
- There is no email digest yet.
- Cloudflare Worker free tier covers expected personal usage.
