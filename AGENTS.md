# JobTrackerLive — Codex context

A Cloudflare Worker that hosts a personal, visa-aware technology job tracker for relocation markets. It combines curated company targets with a daily cloud scan of supported public ATS APIs, diffs against KV state, and serves a static HTML UI that merges curated entries with the dynamic feed.

Built for **Sohaib "King" Kazmi** — Dubai-based BizOps Manager / RevOps consultant looking to relocate into international RevOps, BizOps, Sales Ops, Marketing Ops, GTM Ops, strategy, operations, and broader technology-company roles. Stack: HubSpot, Clay, GoHighLevel, n8n, Make.

## Architecture at a glance

```text
Cloudflare Worker (job-tracker)
├── fetch handler
│   ├── GET /              -> public/index.html (static asset)
│   ├── GET /api/jobs      -> KV "jobs" key (300s cache)
│   └── GET /api/scan-now  -> manual scan trigger (requires X-Scan-Key)
└── scheduled handler (cron: 0 3 * * * UTC)
    └── runScan() -> fetches public ATS boards in batches of 8 -> filters -> KV write

KV namespace: job-tracker-state (id 8cf95c7c04054745bff09d88ea57d707)
├── "state" -> { last_scan, postings: { [id]: { first_seen, last_seen, last_filled? } } }
└── "jobs"  -> flattened public payload (what /api/jobs returns)
```

Supabase MCP project for this app:

- Organization: `SysBlue Supa Org` (`vjqmcajdibrllgtgefjs`)
- Project name: `LiveJobTracker`
- Project ref / project_id: `rjdlgvltsszkjrixifim`
- Region: `eu-west-3`
- Status observed: `ACTIVE_HEALTHY`

When using the Supabase MCP for this repository, use project id `rjdlgvltsszkjrixifim` by default. Do not use the other project in the same organization (`CallBricks App`, ref `thusksxvvecwepulvgdb`) for JobTrackerLive work unless explicitly instructed.

The local scanner has been removed. The app is cloud-only. On load, `public/index.html` fetches `/api/jobs` and merges dynamic postings on top of curated static company-location targets, with `NEW` (within 7 days of `first_seen`) and `FILLED` (no longer listed) badges.

## Files

- `wrangler.toml` — Worker config: KV binding, cron trigger, static asset binding, custom domains
- `src/worker.js` — fetch + scheduled handlers, ATS fetchers, country matching, role-family matching, seniority, visa, scoring
- `public/index.html` — self-contained tracker UI (HTML + CSS + JS in one file)
- `package.json` — wrangler dev dependency and test script
- `test/worker.test.mjs` — scan behavior tests
- `README.md` — full app documentation

## Target geography

15 countries: GB, IE, CA, AU, SG, DE, NL, CH, SE, DK, NO, ES, PT, EE, NZ.
City matching is in `CITY_TO_COUNTRY` and country-level fallback matching is in `COUNTRY_HINTS` in `src/worker.js`.

## Role matching

The scanner now targets broad professional technology-company roles, not only RevOps/GTM Ops. Update `ROLE_FAMILIES`, `ROLE_FALLBACK_KEYWORDS`, and `EXCLUDED_TITLE_KEYWORDS` in `src/worker.js`.

Current families:

- Engineering
- Product
- Design
- Data/Analytics
- Security/IT
- Sales
- Marketing
- Finance
- Operations
- Customer Success/Support
- People/HR
- Legal/Compliance
- Strategy/Program
- Other

`public/index.html` has frontend fallback inference for display only. Keep `inferRoleFamily()` and `inferSeniority()` aligned when changing Worker classification.

## Companies tracked dynamically

Token arrays in `src/worker.js`: `GREENHOUSE_TOKENS`, `ASHBY_TOKENS`, `LEVER_TOKENS`, `SMARTRECRUITERS_TOKENS`.

High-fit ecosystem companies are listed in `HIGH_FIT_COMPANIES` / `ECOSYSTEM_COMPANIES`. Scale-up classification is in `SCALEUP_COMPANIES`. Visa heuristics are in `STRONG_VISA_COMPANIES` and `LIKELY_VISA_COMPANIES`. Use `COMPANY_ALIASES` for non-obvious ATS tokens.

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
curl -H "X-Scan-Key: <your-secret>" "https://livejobindex.com/api/scan-now"
```

## Common follow-ups

- **Add a new public ATS company**: append its ATS token to the relevant token array in `src/worker.js`. If needed, update aliases, tier sets, and visa sets.
- **Add a new static target**: add a company-location entry to `STATIC_COMPANIES` in `public/index.html`.
- **Add a new country**: extend `CITY_TO_COUNTRY` / `COUNTRY_HINTS` in `src/worker.js` and `COUNTRY_NAMES` / `COUNTRY_FLAGS` in `public/index.html`.
- **Add or change role matching**: update `ROLE_FAMILIES`, `ROLE_FALLBACK_KEYWORDS`, or `EXCLUDED_TITLE_KEYWORDS`; mirror display fallback changes in `public/index.html` if needed.
- **Change scoring**: update `calcScore()` in both `src/worker.js` and `public/index.html`.
- **Sync status across devices**: build a `POST /api/status` endpoint that writes to KV, keyed by a session cookie. Replace localStorage calls in `public/index.html` with fetches to `/api/status`.
- **Email digest on new postings**: in `runScan()`, after KV write, count entries where `first_seen === today` and post to a Resend / MailChannels endpoint if count > 0.
- **Debug a specific Greenhouse board**: `curl "https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=false" | jq '.jobs[] | {title, location: .location.name}'`
- **Force a clean re-scan**: `npx wrangler kv:key delete state --binding KV` then hit `/api/scan-now` with `X-Scan-Key`.

## Known limits

- `node_modules/` is gitignored; `package-lock.json` is committed for repeatable installs.
- Proprietary, JS-rendered, login-gated, or bot-protected ATSs are not scanned.
- Static target entries are not live postings.
- Role matching is title-based; job descriptions are not fetched.
- Visa classification is heuristic and company-level.
- Status workflow lives in browser localStorage, so it is per-device.
- There is no email digest or server-side status sync yet.
- Cloudflare Worker free tier covers expected personal usage.

## Verification

```bash
npm test
npx wrangler deploy --dry-run
```

Do not run browser, Playwright, Chrome, or in-app Browser checks for this repository. Sohaib will do manual browser verification when needed. For UI changes, run the automated checks above and clearly note that browser verification was left manual.
