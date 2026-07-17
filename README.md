# Live Jobs Index

Live Jobs Index is a cloud-hosted job-search tracker for finding visa-aware technology and engineering roles abroad. It combines curated company targets with a daily automated scan of public ATS job boards, diffs against KV state, persists app data and scan analytics to Cloudflare D1, and serves a static HTML UI that merges curated entries with the dynamic feed.

Built for **Sohaib "King" Kazmi** — Dubai-based BizOps Manager / RevOps consultant looking to relocate into international RevOps, BizOps, Sales Ops, Marketing Ops, GTM Ops, strategy, operations, and broader technology-company roles.

Live URLs:

- Primary: `https://livejobindex.com`
- Worker direct: disabled in production (`workers_dev = false`)

## Purpose

Instead of repeatedly checking dozens of careers pages, the tracker:

- Scans supported public ATS feeds every day at 03:00 UTC.
- Keeps historical state so newly discovered jobs and recently filled jobs are visible.
- Merges live postings with hand-curated company targets that cannot be reliably scanned.
- Scores roles using visa likelihood, seniority, and freshness.
- Persists account data, saved jobs, tracking events, and scan analytics to Cloudflare D1.
- Gives one place to search, filter, save, star, and track application status.
- Provides an individual-account Resume Studio for verified career evidence, multiple master résumés, job-specific résumé/email packs, ATS diagnostics, private PDF/DOCX exports, daily match notifications, and future-ready credit accounting.
- Focuses on relocation-friendly countries and technology or engineering companies with a realistic sponsorship or international-hiring profile.
- Lets the user switch between `Tech` and `Engineering` feeds, with engineering sub-niches for infrastructure, construction, aerospace, semiconductors, hardware, robotics, automotive, and industrial technology.

## Architecture

```text
Cloudflare Worker: job-tracker
├── fetch handler
│   ├── GET /                  -> static UI from public/index.html
│   ├── GET /jobs              -> server-rendered SEO page (Explore Live Jobs)
│   ├── GET /visa-roles        -> server-rendered SEO page (Visa-Aware Roles)
│   ├── GET /pipeline          -> server-rendered SEO page (My Pipeline)
│   ├── GET /history           -> protected SPA application history and status tracker
│   ├── GET /insights          -> server-rendered SEO page (Market Insights)
│   ├── GET /privacy           -> static asset privacy.html
│   ├── GET /terms             -> static asset terms.html
│   ├── GET /robots.txt        -> static asset
│   ├── GET /sitemap.xml       -> static asset
│   ├── GET /llms.txt          -> static asset
│   ├── GET /api/jobs          -> page 1 of public job payload, optionally filtered by industry (KV, 300s cache)
│   ├── POST /api/jobs/query   -> paged filtered/sorted jobs (page 2+ needs Clerk auth)
│   ├── GET /api/config        -> public config (Clerk hosted auth URLs)
│   ├── POST /api/session      -> create or return anonymous session cookie
│   ├── POST /api/track        -> event tracking (job_view, search, page_view)
│   ├── POST /api/signup       -> legacy route, returns 410 Clerk migration message
│   ├── POST /api/login        -> legacy route, returns 410 Clerk migration message
│   ├── GET /api/auth/google   -> legacy route, redirects to Clerk hosted sign-in
│   ├── GET /auth/callback     -> serves app shell
│   ├── POST /api/auth/session -> legacy route, returns 410 Clerk migration message
│   ├── POST /api/logout       -> returns ok; frontend signs out through Clerk
│   ├── GET /api/me            -> authenticated user + profile + access
│   ├── DELETE /api/me         -> confirmed account, Workflow, private R2, Clerk, and D1 cleanup
│   ├── PATCH /api/onboarding/account-type     -> set individual or agency
│   ├── PATCH /api/onboarding/individual-profile -> save individual profile
│   ├── PATCH /api/onboarding/agency-profile   -> save agency profile
│   ├── POST /api/onboarding/complete          -> finalize onboarding
│   ├── PATCH /api/settings    -> update brand theme
│   ├── POST /api/agency-feedback -> agency feature request / feedback
│   ├── GET /api/user-jobs     -> list authenticated user's job states
│   ├── PUT /api/user-jobs/:id -> upsert job status, star, notes
│   ├── GET /api/user-jobs/:id/history -> job timeline history
│   ├── POST /api/activity     -> log user activity event
│   ├── GET /api/analytics/jobs       -> daily scan stats (owner allowlist required)
│   ├── GET /api/analytics/searches   -> search query history (owner allowlist required)
│   ├── GET /api/analytics/views      -> job view history (owner allowlist required)
│   └── POST /api/scan-now     -> manual scan shard, requires X-Scan-Key
│
├── HTTP redirects
│   ├── http:// -> https:// (301)
│   └── www.livejobindex.com -> livejobindex.com (301)
│
└── scheduled handler (five crons from 03:00-03:40 UTC)
    └── runScan(env, { shardIndex }) -> scan bounded source shard -> filter + score -> safe diff -> KV write
        └── final shard -> persistScanToD1()

Clerk
└── hosted sign-in/sign-up              -> Google and email/password identity

Cloudflare D1: job-tracker-app-db
├── users                               -> Clerk user id, account type, brand theme, onboarding state
├── user_profiles                       -> individual job-seeker profile
├── agency_profiles                     -> agency/data-user profile
├── account_access                      -> plan and gated feature access
├── user_jobs                           -> per-user status, star, notes, timestamps
├── user_job_history                    -> per-job timeline (viewed, status_changed, starred, note_added)
├── user_activity                       -> behavior/event log
├── agency_feedback                     -> agency feature requests and metadata
├── job_postings                        -> master job posting records (upserted per scan, includes industry/niche)
├── job_snapshots                       -> daily snapshot of each posting (for trend analysis, includes industry/niche)
├── daily_scan_stats                    -> aggregated scan statistics per day, including industry/niche counts
├── job_views                           -> anonymous/authenticated job view events
├── search_queries                      -> anonymous/authenticated search events
├── page_views                          -> anonymous/authenticated page view events
└── anonymous_sessions                  -> anonymous session tokens

KV namespace: job-tracker-state
├── state -> full scan state + posting history (prev postings, filled markers, scan_meta)
└── jobs  -> flattened public payload (what /api/jobs and /api/jobs/query consume)
```

Configured Cloudflare resources live in `wrangler.toml`:

- Worker name: `job-tracker`
- Main file: `src/worker.js`
- Compatibility date: `2026-07-15`
- Static assets directory: `./public` (with SPA fallback for `/profile`, `/onboarding`)
- KV binding: `KV` (namespace ID `8cf95c7c04054745bff09d88ea57d707`)
- D1 binding: `DB` (`job-tracker-app-db`, database ID `d0b81077-9b5d-425a-a821-979375f63e89`)
- Crons: `0, 10, 20, 30, 40` minutes past `03:00 UTC`
- Custom domains: `livejobindex.com` and `www.livejobindex.com`
- Observability: enabled

## Files

```text
.
├── AGENTS.md              # Codex working context for this repo
├── README.md              # Full app documentation
├── package.json           # npm scripts, Wrangler, Clerk dependency
├── wrangler.toml          # Cloudflare Worker, assets, KV, D1, cron, routes
├── migrations/            # D1 migrations
├── docs/
│   └── resume-studio-runbook.md # Resume Studio provisioning, rollout, and release checks
├── renderer/              # Private Cloudflare Container service (DOCX, LibreOffice PDF, Poppler/PDF QA)
├── workflow/              # Durable Resume Studio build Workflow
├── public/
│   ├── index.html         # Self-contained HTML, CSS, and browser JS (SPA)
│   ├── privacy.html       # Privacy policy page
│   ├── terms.html         # Terms of service page
│   ├── robots.txt         # Crawler directives
│   ├── sitemap.xml        # SEO sitemap with pillar pages
│   ├── llms.txt           # LLM crawler guidance
│   ├── site.webmanifest   # PWA manifest
│   ├── favicon.ico        # Favicon
│   └── assets/            # Logo, OG image, favicons
├── src/
│   ├── worker.js          # Worker routes, cron handler, scanner, auth, analytics
│   ├── resume-core.js     # Deterministic scoring, file validation, claim and ATS checks
│   └── resume-studio.js   # Tenant APIs, credits, notifications, AI orchestration, artifact access
└── test/
    ├── worker.test.mjs    # Existing Worker and scanner suite
    └── resume-studio.test.mjs # Resume Studio formulas, validation, claims, schema/cascade tests
```

## Runtime Stack

- Cloudflare Workers for compute.
- Cloudflare Workers Assets for the static HTML UI and static files.
- Cloudflare KV for persistent scan state and public job payload.
- Clerk hosted auth (email/password + Google OAuth) for account identity.
- Cloudflare D1 for accounts, profiles, onboarding, user job state, job history, activity, scan analytics, event tracking.
- Wrangler for local development, dry-run validation, deployment, secrets, logs, and KV inspection.
- Plain HTML, CSS, and JavaScript for the frontend SPA.
- Node's built-in `node:test` runner for tests.
- `@clerk/backend` for Worker-side Clerk session verification.
- Cloudflare R2, Queues, Workflows, a private Container renderer, AI Gateway, and Email Sending for the feature-flagged Resume Studio.

There is no separate backend server, frontend build step, or local scanner.

## HTTP Routes

### `GET /`

Serves `public/index.html` through the Worker's assets binding. All paths not matching a known API route, SEO page, legal page, or crawler file fall through to this SPA entry point. The SPA handles client-side routing for `/`, `/visa-roles`, `/profile`, `/onboarding`, `/pipeline`, `/history`, `/insights`, and the protected individual-account `/resumes` Studio.

## Resume Studio v1

Resume Studio imports private PDF/DOCX sources into an unverified career-evidence bank, supports multiple ATS-safe master profiles, hydrates confirmed job descriptions only when needed, generates evidence-cited canonical résumé/email JSON, runs a separate claim audit, and renders selectable-text PDF plus editable DOCX files in a private Container. Downloads are available only after claim and artifact QA pass.

Application packs follow the durable state sequence from `QUEUED` through `READY`, with terminal `NEEDS_EVIDENCE`, `NEEDS_REVIEW`, `JOB_CLOSED`, and `FAILED` outcomes. One `application_pack` credit covers a résumé, three email variants, diagnostics, exports, and up to three reserved AI revision requests. Grants and usage are append-only so later subscriptions or top-ups can create entitlements without replacing the ledger.

All feature flags default off. See [docs/resume-studio-runbook.md](docs/resume-studio-runbook.md) for resources, deployment order, AI Gateway privacy configuration, email-domain prerequisites, rollout, credit reconciliation, and release checks.

### SEO Pillar Pages: `GET /jobs`, `/visa-roles`, `/pipeline`, `/insights`

These are server-rendered HTML pages with full `<head>` meta tags, Open Graph tags, Twitter cards, JSON-LD structured data (`CollectionPage` or `WebPage`), stat cards summarizing the current job feed, and CTAs linking to the SPA. They are cacheable for 300 seconds and include security headers.

Each page renders live job data from KV (active total, visa-aware total, last scan, top markets, top families, top companies).

### `GET /privacy`, `/terms`

Serves the static asset `privacy.html` or `terms.html` with security headers. No SPA fallback.

### `GET /robots.txt`, `/sitemap.xml`, `/llms.txt`

Serves static crawler files with correct content types and security headers.

### `GET /api/jobs`

Returns the first page (15 items) of the latest dynamic job payload from KV key `jobs`, sorted by `first_seen` descending. Optional query string: `industry=tech` or `industry=engineering`; invalid values fall back to `tech`. Response shape:

```json
{
  "last_scan": "2026-06-01",
  "last_scan_at": "2026-06-01T03:00:00.000Z",
  "scan_cycle": { "date": "2026-06-01", "completed_shards": [0, 1, 2, 3, 4], "total_shards": 5, "complete": true },
  "scan_meta": {
    "okCount": 40,
    "failCount": 0,
    "totalBoards": 40,
    "okSources": ["greenhouse-hubspot"],
    "failedSources": []
  },
  "facets": { "country": { "GB": 120, "IE": 45 } },
  "postings": [],
  "pagination": { "page": 1, "per_page": 15, "total": 0, "total_pages": 1, "has_next": false, "has_prev": false }
}
```

Headers: `Cache-Control: public, max-age=300`. No CORS wildcard.

### `POST /api/jobs/query`

Returns paged, filtered, sorted dynamic jobs. `per_page` is capped at 15. The frontend sends `active_only: true`, so filled jobs do not inflate active totals.

Accepts body fields:
- `page`, `per_page`, `sort` (`score`, `company`, `title`, `role`, `country`, `status`, `first_seen`), `dir` (`asc`/`desc`)
- `search` — free text search across company, title, city, country, industry, niche, family, seniority, visa, tier
- `filters` — object with optional arrays: `industry`, `niche`, `country`, `tier`, `family`, `seniority`, `visa`, `presets` (`senior`, `strong-visa`, `new`, `starred`)
- `active_only` — excludes filled postings when true
- `ids` — specific posting IDs to fetch

Page 1 is public. Page 2+ and the user-specific `starred` preset require an authenticated Clerk session token. Responses include country facets calculated from the full filtered result set, not just the current page. Low bot score requests (`cf.botManagement.score < 30`, non-verified) are rejected before processing.

Legacy `Ecosystem` tier values are normalized to `GrowthSaaS`.

### `GET /api/config`

Returns public config:

```json
{
  "clerk_publishable_key": "",
  "clerk_sign_in_url": "",
  "clerk_sign_up_url": ""
}
```

Cacheable for 300 seconds.

### `POST /api/session`

Creates an anonymous session cookie (`lji_session`, HttpOnly, 365-day TTL) if one does not already exist. Returns the session token and writes it to D1 `anonymous_sessions` when the `DB` binding is available.

### `POST /api/track`

Records anonymous or authenticated events to D1. Accepts:
- `type`: `job_view`, `search`, `page_view` (required)
- Event-specific fields: `job_id`, `source`, `query_text`, `filters`, `result_count`, `page_path`, `referrer`

Silently ignores errors so tracking never breaks the UX.

### Account routes

Clerk-backed account routes verify `Authorization: Bearer <Clerk session token>` in the Worker. Routes:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/signup` | Legacy route. Returns `410` with `clerk_auth_required`. |
| POST | `/api/login` | Legacy route. Returns `410` with `clerk_auth_required`. |
| GET | `/api/auth/google` | Legacy route. Redirects to the configured Clerk hosted sign-in URL. |
| GET | `/auth/callback` | Serves the frontend app shell. Clerk hosted auth returns to normal app routes. |
| POST | `/api/auth/session` | Legacy route. Returns `410` with `clerk_auth_required`. |
| POST | `/api/logout` | Returns `{ ok: true }`; frontend calls `Clerk.signOut()` first. |
| GET | `/api/me` | Returns auth_user, user, profiles, account_access. Auto-creates account rows if missing. |
| PATCH | `/api/onboarding/account-type` | Sets `individual` or `agency`, resets onboarding. |
| PATCH | `/api/onboarding/individual-profile` | Saves individual profile (name, title, experience, target families/countries, etc.). |
| PATCH | `/api/onboarding/agency-profile` | Saves agency profile (name, type, use case, markets, etc.). |
| POST | `/api/onboarding/complete` | Validates profile exists for account type, sets `onboarding_completed: true`. |
| PATCH | `/api/settings` | Updates brand theme (`cobalt`, `graphite`, `aurora`). |
| POST | `/api/agency-feedback` | Submits agency feature request (requires completed agency onboarding). |
| GET | `/api/user-jobs` | Returns all authenticated user's job states plus D1-hydrated posting details for historical pipeline rows. |
| PUT | `/api/user-jobs/:job_id` | Upserts job status, star, notes. Auto-sets `saved_at`, `applied_at`, `archived_at` on transition. Records job history events. |
| GET | `/api/user-jobs/:job_id/history` | Returns job timeline (viewed, status_changed, starred, note_added). |
| POST | `/api/activity` | Logs a user activity event to `user_activity`. |

These routes require Clerk keys/secrets and the `DB` D1 binding in the Worker environment.

Google and email/password sign-in use Clerk hosted pages. The frontend loads ClerkJS, redirects via Clerk hosted sign-in/sign-up, then attaches a Clerk session token to authenticated API calls.

### Analytics endpoints

Owner-only authenticated GET endpoints. The signed-in user's email must be present in `ANALYTICS_ALLOWED_EMAILS`.
| Path | Description |
|------|-------------|
| `GET /api/analytics/jobs?days=30` | Returns `daily_scan_stats` (total, new, filled, per-source, per-country, per-family, per-tier). |
| `GET /api/analytics/searches?days=7` | Returns `search_queries` history. |
| `GET /api/analytics/views?days=7` | Returns `job_views` history. |

### `POST /api/scan-now`

Runs one scanner shard manually. Requires `X-Scan-Key` matching the `SCAN_KEY` secret; no query-string key is accepted. Use `?shard=0` through `?shard=4` for a deterministic full cycle, or omit it to run the next incomplete shard. D1 analytics are persisted only when the fifth shard completes the daily cycle.

```json
{ "okCount": 23, "failCount": 0, "partialCount": 0, "total": 3267, "shardIndex": 0, "completedShards": [0], "cycleComplete": false }
```

Error responses:
- `{ "error": "all_fetch_failed", "okCount": 0, "failCount": 40, "failedSources": [] }`
- `{ "error": "too_many_fetch_failures", "okCount": 10, "failCount": 30, "totalBoards": 40, "failedSources": [] }`

`GET /api/scan-now` returns `405 Method Not Allowed`. A shard-level scan failure returns HTTP `503` rather than a misleading success response.

## Scheduled Scan

Five cron triggers run daily at `03:00`, `03:10`, `03:20`, `03:30`, and `03:40` UTC. Each invocation scans one bounded source shard so the Worker stays below Cloudflare's free-plan external-subrequest limit. KV exposes cycle progress after every shard; `last_scan` advances and D1 is updated only after all five shards complete.

## Dynamic Sources

The scanner supports reliable public ATS APIs plus a small set of bounded custom parsers for popular tech companies:
- Greenhouse
- Ashby
- Lever
- SmartRecruiters
- Amazon Jobs search JSON
- Apple Careers server-rendered search data
- Netflix Eightfold `smartApplyData.positions`

Source tokens in `src/worker.js`:

```js
GREENHOUSE_TOKENS = ["gongio", "klaviyo", "datadog", "cloudflare", "hubspot", "pleo", "celonis", "airtable", "gitlab", "figma", "brex", "mercury", "vercel", "typeform", "feedzai", "mentimeter", "trustpilot", "twilio", "asana", "databricks", "mongodb", "elastic", "remote", "sumologic", "contentful", "n26", "cognite", "talkdesk2", "boxinc", "anthropic", "stripe", "pinterest", "linkedin"]

ASHBY_TOKENS = ["confluent", "deel", "linear", "mollie", "notion", "ramp", "snowflake", "xero", "openai", "cursor", "perplexity"]

LEVER_TOKENS = ["pipedrive"]

SMARTRECRUITERS_TOKENS = ["canva", "wise"]
```

Company aliases normalize non-obvious ATS tokens: `talkdesk2` → `talkdesk`, `boxinc` → `box`, `aws` → `amazon`.

Popular-tech custom sources are defined through structured source objects with `source`, `token`, `company`, `industry`, `niche`, `tier`, `visa`, and `fetch`. They remain bounded by fixed country/page/result caps and failures are isolated by source so one fragile parser does not abort the whole scan.

Bot-protected and unreliable engineering ATS pages are not live-scraped. Those companies remain curated company-location targets in `ENGINEERING_STATIC_COMPANIES` until a stable public endpoint is verified and covered by tests.

## ATS Fetching

Each fetcher returns a normalized object: `{ id, title, location, url }`.

- **Greenhouse**: `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=false`
- **Ashby**: `https://api.ashbyhq.com/posting-api/job-board/{token}` — secondary locations expanded into separate postings.
- **Lever**: `https://api.lever.co/v0/postings/{token}?mode=json` — `allLocations` expanded into separate postings.
- **SmartRecruiters**: `https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100&offset={offset}` — paginated up to 10 pages of 100.
- **Amazon Jobs**: `https://www.amazon.jobs/en/search.json` — searches a bounded list of target countries with a fixed per-location result limit.
- **Apple Careers**: `https://jobs.apple.com/{locale}/search?sort=newest` — parses server-rendered search data and expands multi-location roles into stable per-location postings.
- **Netflix Careers**: `https://explore.jobs.netflix.net/careers` — parses Eightfold `smartApplyData.positions`, including `canonicalPositionUrl` and expanded locations.
- **Y Combinator / Work at a Startup**: one logical `yc-waas` source fetches a bounded set of YC seed pages (`/jobs`, major role pages, remote role pages, and San Francisco/Silicon Valley pages), parses the server-rendered `data-page` payload, deduplicates by YC posting id, and enriches company metadata from `https://yc-oss.github.io/api/companies/hiring.json`.

YC freshness uses this app's `first_seen` date, not YC's relative `createdAt` labels. If some YC seed pages fail but at least one parses, the scan keeps newly found YC jobs and preserves previous unmatched YC jobs to avoid false filled markers; page-level failures are recorded in `scan_meta.sourceMeta["yc-yc-waas"]`.

Meta, Google, Microsoft, and other proprietary, browser-bound, GraphQL-heavy, login-gated, or bot-protected boards stay static unless a stable public endpoint is verified and covered by fixtures. Static rows remain company-location targets, not confirmed live postings. Live postings take precedence where live coverage exists.

## Target Geography

26 focused relocation and tech-hub countries: `GB`, `IE`, `CA`, `AU`, `US`, `SG`, `DE`, `NL`, `CH`, `SE`, `DK`, `NO`, `ES`, `PT`, `EE`, `NZ`, `FR`, `IT`, `PL`, `BE`, `FI`, `AT`, `JP`, `KR`, `IN`, `TW`.

Location matching uses two layers:
- `CITY_TO_COUNTRY`: specific city names (London, Dublin, Toronto, Sydney, San Francisco, New York, Seattle, Austin, Berlin, Amsterdam, Paris, Milan, Warsaw, Brussels, Helsinki, Vienna, Tokyo, Seoul, Bengaluru, Hyderabad, Mumbai, Taipei, etc.)
- `COUNTRY_HINTS`: country-level text (United Kingdom, Ireland, Canada, United States, Singapore, France, Japan, South Korea, India, Taiwan, etc.)

Startup-focused aliases include `NYC`, `SF`, Bay Area cities, and country-qualified remote strings such as `US / Remote (US)`.

## Role Matching

The scanner classifies job titles into broad professional technology-company role families:

- Engineering, Product, Design, Data/Analytics, Security/IT, Sales, Marketing, Finance, Operations, Customer Success/Support, People/HR, Legal/Compliance, Strategy/Program, Other

A job is kept when its title matches one of the configured family keyword lists, or a generic fallback keyword (engineer, developer, designer, analyst, manager, lead, director, specialist, associate, consultant, architect, administrator).

Excluded title fragments: intern, apprenticeship, graduate program, working student, campus ambassador, risk/ethics, advocacy & legal.

## Company Classification

Each dynamic posting gets a tier:

- **GrowthSaaS**: hubspot, gongio, klaviyo, pleo, personio, typeform, factorialhr, talkdesk, mollie, pipedrive, mentimeter, deel, kahoot, notion, xero, trustpilot, miro, outsystems
- **Scaleup**: celonis, airtable, gitlab, figma, linear, ramp, brex, mercury, vercel, travelperk, glovo, feedzai, unbabel, klarna, templafy, remote, monday, contentful, n26, cognite, wise, bolt, canva, asana, shopify
- **BigTech**: default for larger or uncategorized technology companies

YC jobs default to `Scaleup`; early B2B/SaaS-style YC companies are classified as `GrowthSaaS`, while larger or growth-stage YC companies stay `Scaleup`.

## Visa Classification

Visa likelihood is company-level (not per-posting):

- **Strong**: hubspot, datadog, cloudflare, gitlab, figma, twilio, databricks, mongodb, elastic, confluent, deel, snowflake, xero, canva, wise
- **Likely**: gongio, klaviyo, pleo, celonis, airtable, brex, mercury, vercel, typeform, feedzai, mentimeter, trustpilot, asana, remote, sumologic, contentful, n26, cognite, linear, mollie, notion, ramp, pipedrive, talkdesk, box
- **Unknown**: all others

This is a prioritization heuristic, not a sponsorship guarantee.

YC jobs use posting-level visa text where available: `Will sponsor` maps to `Strong`, `US citizenship/visa not required` or YC `askUs` maps to `Likely`, and US-only or missing text maps to `Unknown`.

## Scoring

```js
score = round(visa * 0.5 + seniority * 0.3 + freshness * 0.2)
```

| Component | Values |
|-----------|--------|
| Visa | Strong=100, Likely=75, Unknown=50 |
| Seniority | Executive=95, Director/Head=90, Senior/Lead=85, Manager=80, Associate/Analyst=70, Unknown=65 |
| Freshness | Filled=30, new (<7d)=100, older active=80 |

UI thresholds: High ≥80, Medium ≥70, Low <70.

## Diffing And Filled Jobs

The scanner compares current scan results against previous `state.postings`:

- **Same posting found** → preserves `first_seen`, updates `last_seen`, clears `last_filled`.
- **Posting disappeared from a complete successful source snapshot** → marked filled with `last_filled`, retained in feed for 7 days, then pruned.
- **Source failed** → previous postings from that source are preserved (no filled markers).
- **Source is paginated, truncated, or only partially parsed** → new results are accepted, but unmatched prior jobs are preserved instead of being falsely marked filled.
- **Partial source remains unmatched for more than 30 days** → treated as stale and enters the normal 7-day filled retention window.
- **Unscanned shard** → previous postings are preserved unchanged.
- **All sources in a shard fail, or a larger shard exceeds the failure threshold** → shard aborts, KV is not written.
- **All sources fail** → returns `all_fetch_failed`, KV not written.
- **Retired sources** (`ACTIVE_SOURCES`) → postings from non-active sources are dropped.

## D1 Persistence

After a complete five-shard daily cycle, `persistScanToD1()` writes three data sets:

1. **job_postings** — upsert by `id`: master record with `first_seen_date`, `last_seen_date`, `last_filled_date`, `is_active`.
2. **job_snapshots** — upsert by `(job_id, scan_date)`: daily snapshot with title, location, city, country, role_family, seniority, visa, score, tier, `is_new`, `is_filled`.
3. **daily_scan_stats** — upsert by `scan_date`: aggregated counts (total, new, filled, per-source, per-country, per-family, per-tier, ok/fail counts).

This enables trend analysis, market insights, and the `/api/analytics/jobs` endpoint.

## Frontend UI

The entire SPA lives in `public/index.html`. Features:

- **Header**: logo, title, subtitle, last-scan status, login/signup buttons, profile pill (when signed in), theme toggle button.
- **Brand themes**: Cobalt, Graphite (default), Aurora — selectable per-account via profile settings or header toggle.
- **Auth modal**: Clerk hosted sign-in/sign-up redirects for Google and email/password.
- **Onboarding flow**: account type choice (individual/agency), resumable profile setup, and server-validated default filters for target countries, role families, seniority, and visa need.
- **Profile panel**: brand theme switcher, editable individual or agency profile.
- **Tabs**: Live jobs, Visa Roles (SEO route), Targets, My pipeline, Application history, Archive, Market Insights (SEO route).
- **Stats cards**: live roles count, new this week, strong visa, top markets, in-pipeline.
- **Filters**: role family, seniority, visa eligibility, country, quick presets (Senior+, Strong visa, New, Starred).
- **Search + sort**: free text search across company/role/family/city/notes, sort by newest, company, role, country, status.
- **Desktop table**: company, role, location, signals (tier/family/seniority/visa badges), apply link, notes, status dropdown.
- **Mobile cards**: responsive card layout replaces table on screens <800px.
- **Pagination**: page buttons, with page 2+ requiring Clerk sign-in.
- **Pipeline view**: timeline history with event dots (viewed, status_changed, starred, note_added) and time formatting.
- **Application history**: protected, newest-update-first tracker for every job ever marked Applied, with inline stage updates and an expandable status-only timeline.
- **Anonymous session + tracking**: `lji_session` cookie, event tracking (job_view, search, page_view) to D1.
- **Agency banner**: feedback form for agency users.
- **Legend**: score breakdown, badge meanings.
- **Methodology note**: tracking methodology disclaimer.
- **Footer**: social links, contact emails, legal/site links.
- **Empty state**: identifies the active filters behind zero results and offers a reset action.

## Tabs

- **Live jobs**: active dynamic postings (not filled, not in pipeline/archive).
- **Targets**: static curated company-location entries from `STATIC_COMPANIES`.
- **My pipeline**: jobs with status Saved, Applied, Recruiter screen, Interview, Final round, Offer.
- **Archive**: jobs with status Rejected, On hold; auto-includes filled dynamic postings not already in another bucket.
- **Visa Roles / Market Insights**: server-rendered SEO pages linking back to SPA.

## Personal State

Job state (status, star, notes) and brand theme sync across devices via D1 after Clerk sign-in. Theme also caches in localStorage (`livejobindex_brand_theme`) for immediate apply on page load.

Job-search filter snapshots are browser-local but scoped per Clerk user so one account cannot inherit another account's filters. Onboarding defaults are stored in D1 profile data and reapplied when no user-controlled filter snapshot exists.

Statuses: Not started, Saved, Applied, Recruiter screen, Interview, Final round, Offer, Rejected, On hold.

Clicking `Apply` on a live dynamic job auto-moves status from `Not started` or `Saved` to `Applied`. Static target rows use a `Search` button and do not auto-change status.

## Static Curated Targets

`STATIC_COMPANIES` in `public/index.html` contains ~95 curated company-location entries for companies with proprietary, JS-rendered, login-gated, or bot-protected careers pages. These are not live postings — they are careers-search targets.

Examples: Salesforce, Google, Meta, Microsoft, Adobe, ServiceNow, Atlassian, Shopify, Personio, Miro, Klarna, Spotify, Zendesk, NVIDIA, Tesla, and other companies whose careers pages are not safely fetchable live. Some companies may appear in both static targets and live feeds; confirmed live postings take precedence in the Live jobs tab.

Static rows use `role: "Company career target"`, `role_family: "Multiple"`, `seniority: "Any"`. Deduplicated by `company | country | city`.

## HTTP Redirects

- **HTTP → HTTPS**: redirects `http://` requests to `https://` (301).
- **www → naked domain**: redirects `www.livejobindex.com` to `livejobindex.com` (301).

## Local Development

```bash
npm install
npm run dev
```

## Deployment

1. Login and deploy:
```bash
npx wrangler login
npm run deploy
```

2. Set required secrets:
```bash
npx wrangler secret put SCAN_KEY
npx wrangler secret put CLERK_PUBLISHABLE_KEY
npx wrangler secret put CLERK_SECRET_KEY
npx wrangler secret put CLERK_JWT_KEY
npx wrangler secret put CLERK_SIGN_IN_URL
npx wrangler secret put CLERK_SIGN_UP_URL
npx wrangler secret put ANALYTICS_ALLOWED_EMAILS
npx wrangler secret put RESUME_STUDIO_ALLOWED_USERS
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put AI_GATEWAY_URL
npx wrangler secret put AI_GATEWAY_TOKEN
```

3. Trigger the five shards for the first complete scan:
```bash
for shard in 0 1 2 3 4; do
  curl -X POST -H "X-Scan-Key: <your-secret>" "https://livejobindex.com/api/scan-now?shard=$shard"
  [ "$shard" = 4 ] || sleep 65
done
```

The pause avoids Cloudflare KV propagation races between separate manual requests. The scheduled crons are already spaced ten minutes apart.

For D1 schema migrations (if changing tables):
```bash
npx wrangler d1 migrations apply job-tracker-app-db --local
npx wrangler d1 migrations apply job-tracker-app-db --remote
```

## Operational Commands

```bash
npx wrangler tail                          # Tail live logs
npx wrangler kv:key get jobs --binding KV  # Read public jobs payload
npx wrangler kv:key get state --binding KV # Read full scan state
curl -X POST -H "X-Scan-Key: <SCAN_KEY>" "https://livejobindex.com/api/scan-now?shard=0"
```

Debug a Greenhouse board:
```bash
curl "https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=false" | jq '.jobs[] | {title, location: .location.name}'
```

## Tests

The test suite (100+ tests) covers:

- Location matching (lowercase, country-hint, multi-city)
- Visa classification and company aliases
- Broad role-family classification across all families
- Early-career and noisy-title exclusion
- Preserving previous postings from failed active sources
- Dropping postings from retired sources
- Aborting KV writes when too many sources fail
- Manual scan auth with `X-Scan-Key`
- Canonical HTTP redirects
- Legal page and crawler file asset serving
- SEO pillar page rendering (title, canonical, structured data, email contacts)
- Homepage source structure (tabs, route handling, brand theme defaults)
- Account route authentication gate
- Jobs query pagination, tier normalization, bot score rejection
- Clerk-only page 2+ jobs query access
- Clerk legacy auth endpoint behavior
- Onboarding completion validation (individual + agency)
- User job upsert with derived timestamps
- Settings brand theme validation
- Agency feedback auth, validation, and metadata collection
- D1 scan persistence (upserts to job_postings, job_snapshots, daily_scan_stats)
- Anonymous session creation and existing token return
- Event tracking (job_view, search, page_view) and invalid event rejection
- Analytics endpoint auth requirements

Run:
```bash
npm test
```

Validate deployment:
```bash
npx wrangler deploy --dry-run
```

## Common Changes

### Add a new public ATS company

1. Append the company token to `GREENHOUSE_TOKENS`, `ASHBY_TOKENS`, `LEVER_TOKENS`, or `SMARTRECRUITERS_TOKENS` in `src/worker.js`.
2. Add a `COMPANY_ALIASES` entry if the token differs from the display name.
3. Add to `GROWTH_SAAS_COMPANIES`, `SCALEUP_COMPANIES`, `STRONG_VISA_COMPANIES`, or `LIKELY_VISA_COMPANIES` if applicable.
4. Run tests, deploy.

For a bounded custom source, add a structured entry with `source`, `token`, `company`, `industry`, `niche`, `tier`, `visa`, and `fetch`, plus fixture-backed tests for the parser shape and failure isolation.

### Add a new target country or city

1. Update `CITY_TO_COUNTRY` and `COUNTRY_HINTS` in `src/worker.js`, including country-level aliases and key city/remote-location variants.
2. Update `COUNTRY_NAMES` and `COUNTRY_FLAGS` in `public/index.html`.
3. Run tests, deploy.

### Change role matching

Update `ROLE_FAMILIES`, `ROLE_FALLBACK_KEYWORDS`, or `EXCLUDED_TITLE_KEYWORDS` in `src/worker.js`. Mirror frontend fallback in `inferRoleFamily()` and `inferSeniority()` in `public/index.html`.

### Change scoring

Update `calcScore()` in both `src/worker.js` and `public/index.html`.

### Add a static curated target

Add an entry to `STATIC_COMPANIES` in `public/index.html`:

```js
{ id: 96, company: 'ExampleCo', country: 'GB', city: 'London', tier: 'Scaleup', visa: 'Likely', apply: 'https://example.com/careers?location=London' }
```

For engineering companies, add the entry to `ENGINEERING_STATIC_COMPANIES` and include `niche`:

```js
{ id: 1200, company: 'Example Engineering', country: 'GB', city: 'London', tier: 'Scaleup', visa: 'Likely', niche: 'AEC / Infrastructure', apply: 'https://example.com/careers' }
```

### Add a new D1 table

1. Create a migration file under `migrations/`.
2. Update the schema diagram in Architecture section of this README.
3. If the scanner writes to it, add upsert logic in `persistScanToD1()` in `src/worker.js`.
4. If it has an API endpoint, add the route handler and wire it in the fetch handler.

### Debug scans

- Force re-scan: delete KV state and trigger scan.
- Check individual ATS: use curl/jq on the ATS endpoint.
- Check scan results: `npx wrangler kv:key get jobs --binding KV`.

## Known Limits

- Only public ATS APIs that are explicitly supported are scanned.
- Proprietary, JavaScript-rendered, login-gated, and bot-protected careers sites are not scanned.
- Static target entries are not live postings.
- Visa classification is heuristic and company-level, not posting-level.
- The normal scan remains title-based. Resume Studio hydrates supported live job descriptions lazily for matching and builds; unsupported pages require pasted text.
- Page 2+ of job results requires Clerk sign-in.
- KV is eventually consistent, so very recent writes may take a short time to propagate.
- Daily digest code and binding are implemented but disabled until `livejobindex.com` Email Sending onboarding, sender authentication, DMARC review, and manual delivery verification are complete.
- Resume Studio and all daily/automatic behaviors are feature-flagged off by default; the private renderer also requires a Docker-built Cloudflare Container deployment.
- The app is optimized for low personal usage, not high-volume public traffic.

## Future Improvements

- Email digest for jobs first seen today (binding already configured).
- CSV/JSON export of job feed.
- Role-description fetching for deeper matching where APIs allow it.
- Separate scoring profiles for RevOps-only vs broad tech roles.
- Public changelog of scanner sources and rule changes.
