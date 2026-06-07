# Live Job Index

Live Job Index is a cloud-hosted job-search tracker for finding visa-aware technology roles abroad. It combines curated company targets with a daily automated scan of public ATS job boards, diffs against KV state, persists scan analytics to Supabase, and serves a static HTML UI that merges curated entries with the dynamic feed.

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
- Persists scan results and analytics to Supabase for trend analysis.
- Gives one place to search, filter, save, star, and track application status.
- Focuses on relocation-friendly countries and technology companies with a realistic sponsorship or international-hiring profile.

## Architecture

```text
Cloudflare Worker: job-tracker
├── fetch handler
│   ├── GET /                  -> static UI from public/index.html
│   ├── GET /jobs              -> server-rendered SEO page (Explore Live Jobs)
│   ├── GET /visa-roles        -> server-rendered SEO page (Visa-Aware Roles)
│   ├── GET /pipeline          -> server-rendered SEO page (My Pipeline)
│   ├── GET /insights          -> server-rendered SEO page (Market Insights)
│   ├── GET /privacy           -> static asset privacy.html
│   ├── GET /terms             -> static asset terms.html
│   ├── GET /robots.txt        -> static asset
│   ├── GET /sitemap.xml       -> static asset
│   ├── GET /llms.txt          -> static asset
│   ├── GET /api/jobs          -> page 1 of public job payload (KV, 300s cache)
│   ├── POST /api/jobs/query   -> paged filtered/sorted jobs (page 2+ needs auth + Turnstile)
│   ├── GET /api/config        -> public config (Turnstile site key)
│   ├── POST /api/session      -> create or return anonymous session cookie
│   ├── POST /api/track        -> event tracking (job_view, search, page_view)
│   ├── POST /api/signup       -> email/password registration
│   ├── POST /api/login        -> email/password login
│   ├── GET /api/auth/google   -> legacy route, redirects to frontend auth error
│   ├── GET /auth/callback     -> serves app shell for browser-side Supabase OAuth completion
│   ├── POST /api/auth/session -> validates browser OAuth tokens and sets HttpOnly session cookies
│   ├── POST /api/logout       -> sign out
│   ├── GET /api/me            -> authenticated user + profile + access
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
│   └── GET /api/scan-now      -> manual scan, requires X-Scan-Key
│
├── HTTP redirects
│   ├── http:// -> https:// (301)
│   └── www.livejobindex.com -> livejobindex.com (301)
│
└── scheduled handler (cron: 0 3 * * * UTC)
    └── runScan(env) -> scan ATS feeds -> filter + score -> diff KV state -> KV write -> persistScanToSupabase()

Supabase
├── auth.users                          -> email/password and Google OAuth identity
├── public.users                        -> account type, brand theme, onboarding state
├── public.user_profiles                -> individual job-seeker profile
├── public.agency_profiles              -> agency/data-user profile
├── public.account_access               -> plan and gated feature access
├── public.user_jobs                    -> per-user status, star, notes, timestamps
├── public.user_job_history             -> per-job timeline (viewed, status_changed, starred, note_added)
├── public.user_activity                -> behavior/event log
├── public.agency_feedback              -> agency feature requests and metadata
├── public.job_postings                 -> master job posting records (upserted per scan)
├── public.job_snapshots                -> daily snapshot of each posting (for trend analysis)
├── public.daily_scan_stats             -> aggregated scan statistics per day
├── public.job_views                    -> anonymous/authenticated job view events
├── public.search_queries               -> anonymous/authenticated search events
├── public.page_views                   -> anonymous/authenticated page view events
└── public.anonymous_sessions           -> anonymous session tokens

KV namespace: job-tracker-state
├── state -> full scan state + posting history (prev postings, filled markers, scan_meta)
└── jobs  -> flattened public payload (what /api/jobs and /api/jobs/query consume)
```

Configured Cloudflare resources live in `wrangler.toml`:

- Worker name: `job-tracker`
- Main file: `src/worker.js`
- Compatibility date: `2026-06-05`
- Static assets directory: `./public` (with SPA fallback for `/profile`, `/onboarding`)
- KV binding: `KV` (namespace ID `8cf95c7c04054745bff09d88ea57d707`)
- Cron: `0 3 * * *`
- Custom domains: `livejobindex.com` and `www.livejobindex.com`
- Observability: enabled

## Files

```text
.
├── AGENTS.md              # Codex working context for this repo
├── README.md              # Full app documentation
├── package.json           # npm scripts, Wrangler, Supabase dependencies
├── wrangler.toml          # Cloudflare Worker, assets, KV, cron, routes
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
│   └── worker.js          # Worker routes, cron handler, scanner, scoring, auth, analytics
└── test/
    └── worker.test.mjs    # Node test suite (1260+ lines, ~80 tests)
```

## Runtime Stack

- Cloudflare Workers for compute.
- Cloudflare Workers Assets for the static HTML UI and static files.
- Cloudflare KV for persistent scan state and public job payload.
- Supabase Auth (email/password + Google OAuth) for account identity.
- Supabase Postgres for accounts, profiles, onboarding, user job state, job history, activity, scan analytics, event tracking.
- Cloudflare Turnstile for human verification on pagination gate.
- Wrangler for local development, dry-run validation, deployment, secrets, logs, and KV inspection.
- Plain HTML, CSS, and JavaScript for the frontend SPA.
- Node's built-in `node:test` runner for tests.
- `@supabase/ssr` and `@supabase/supabase-js` for server-side auth client.

There is no separate backend server, frontend build step, or local scanner.

## HTTP Routes

### `GET /`

Serves `public/index.html` through the Worker's assets binding. All paths not matching a known API route, SEO page, legal page, or crawler file fall through to this SPA entry point. The SPA handles client-side routing for `/`, `/visa-roles`, `/profile`, `/onboarding`, `/pipeline`, `/insights`.

### SEO Pillar Pages: `GET /jobs`, `/visa-roles`, `/pipeline`, `/insights`

These are server-rendered HTML pages with full `<head>` meta tags, Open Graph tags, Twitter cards, JSON-LD structured data (`CollectionPage` or `WebPage`), stat cards summarizing the current job feed, and CTAs linking to the SPA. They are cacheable for 300 seconds and include security headers.

Each page renders live job data from KV (active total, visa-aware total, last scan, top markets, top families, top companies).

### `GET /privacy`, `/terms`

Serves the static asset `privacy.html` or `terms.html` with security headers. No SPA fallback.

### `GET /robots.txt`, `/sitemap.xml`, `/llms.txt`

Serves static crawler files with correct content types and security headers.

### `GET /api/jobs`

Returns the first page (15 items) of the latest dynamic job payload from KV key `jobs`, sorted by `first_seen` descending. Response shape:

```json
{
  "last_scan": "2026-06-01",
  "last_scan_at": "2026-06-01T03:00:00.000Z",
  "scan_meta": {
    "okCount": 40,
    "failCount": 0,
    "totalBoards": 40,
    "okSources": ["greenhouse-hubspot"],
    "failedSources": []
  },
  "postings": [],
  "pagination": { "page": 1, "per_page": 15, "total": 0, "total_pages": 1, "has_next": false, "has_prev": false }
}
```

Headers: `Cache-Control: public, max-age=300`. No CORS wildcard.

### `POST /api/jobs/query`

Returns paged, filtered, sorted dynamic jobs. `per_page` capped at 15.

Accepts body fields:
- `page`, `per_page`, `sort` (`score`, `company`, `title`, `role`, `country`, `status`, `first_seen`), `dir` (`asc`/`desc`)
- `search` — free text search across company, title, city, country, family, seniority, visa, tier
- `filters` — object with optional arrays: `country`, `tier`, `family`, `seniority`, `visa`, `presets` (`senior`, `strong-visa`, `new`)
- `ids` — specific posting IDs to fetch
- `turnstile_token` — Cloudflare Turnstile token for page 2+

Page 1 is public. Page 2+ requires an authenticated Supabase session AND either a valid `job_page_access` HMAC-signed cookie or a fresh Turnstile token. Low bot score requests (`cf.botManagement.score < 30`, non-verified) are rejected before processing.

Legacy `Ecosystem` tier values are normalized to `GrowthSaaS`.

### `GET /api/config`

Returns public config:

```json
{ "turnstile_site_key": "" }
```

Cacheable for 300 seconds.

### `POST /api/session`

Creates an anonymous session cookie (`lji_session`, HttpOnly, 365-day TTL) if one does not already exist. Returns the session token. Optionally persists the token to Supabase `anonymous_sessions` if the service role key is configured.

### `POST /api/track`

Records anonymous or authenticated events to Supabase. Accepts:
- `type`: `job_view`, `search`, `page_view` (required)
- Event-specific fields: `job_id`, `source`, `query_text`, `filters`, `result_count`, `page_path`, `referrer`

Silently ignores errors so tracking never breaks the UX.

### Account routes

Supabase-backed account routes use `@supabase/ssr` with HttpOnly session cookies. Routes:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/signup` | Email/password registration. Returns 201 or `confirmation_required` if email confirmation is enabled. |
| POST | `/api/login` | Email/password login. Updates `last_login_at`, records activity, returns `fetchMe()` payload. |
| GET | `/api/auth/google` | Legacy route. Redirects to `/?auth_error=google_frontend_required`; Google OAuth is initiated by the browser Supabase client. |
| GET | `/auth/callback` | Serves the frontend app shell so the browser can complete Supabase OAuth. |
| POST | `/api/auth/session` | Accepts browser Supabase `access_token` and `refresh_token`, validates them server-side, sets HttpOnly session cookies, ensures account rows, updates `last_login_at`, and records activity. |
| POST | `/api/logout` | Signs out, clears session cookies. |
| GET | `/api/me` | Returns auth_user, user, profiles, account_access. Auto-creates account rows if missing. |
| PATCH | `/api/onboarding/account-type` | Sets `individual` or `agency`, resets onboarding. |
| PATCH | `/api/onboarding/individual-profile` | Saves individual profile (name, title, experience, target families/countries, etc.). |
| PATCH | `/api/onboarding/agency-profile` | Saves agency profile (name, type, use case, markets, etc.). |
| POST | `/api/onboarding/complete` | Validates profile exists for account type, sets `onboarding_completed: true`. |
| PATCH | `/api/settings` | Updates brand theme (`cobalt`, `graphite`, `aurora`). |
| POST | `/api/agency-feedback` | Submits agency feature request (requires completed agency onboarding). |
| GET | `/api/user-jobs` | Returns all authenticated user's job states sorted by `updated_at` desc. |
| PUT | `/api/user-jobs/:job_id` | Upserts job status, star, notes. Auto-sets `saved_at`, `applied_at`, `archived_at` on transition. Records job history events. |
| GET | `/api/user-jobs/:job_id/history` | Returns job timeline (viewed, status_changed, starred, note_added). |
| POST | `/api/activity` | Logs a user activity event to `user_activity`. |

These routes require `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the Worker environment.

Google sign-in uses the browser Supabase client loaded from jsDelivr. Supabase redirects back to `https://livejobindex.com/auth/callback`; the frontend exchanges the OAuth code with Supabase, then posts the resulting tokens to `/api/auth/session` so the Worker can set HttpOnly session cookies.

### Analytics endpoints

Owner-only authenticated GET endpoints. The signed-in user's email must be present in `ANALYTICS_ALLOWED_EMAILS`.
| Path | Description |
|------|-------------|
| `GET /api/analytics/jobs?days=30` | Returns `daily_scan_stats` (total, new, filled, per-source, per-country, per-family, per-tier). |
| `GET /api/analytics/searches?days=7` | Returns `search_queries` history. |
| `GET /api/analytics/views?days=7` | Returns `job_views` history. |

### `GET /api/scan-now`

Runs the scanner manually. Requires `X-Scan-Key` header matching the `SCAN_KEY` secret. No query-string key accepted. On success, also persists scan results to Supabase via `ctx.waitUntil`:

```json
{ "okCount": 40, "failCount": 0, "total": 26 }
```

Error responses:
- `{ "error": "all_fetch_failed", "okCount": 0, "failCount": 40, "failedSources": [] }`
- `{ "error": "too_many_fetch_failures", "okCount": 10, "failCount": 30, "totalBoards": 40, "failedSources": [] }`

## Scheduled Scan

The cron trigger runs daily at `0 3 * * *` UTC (7 AM Dubai). The `scheduled()` handler calls `runScan(env)` and on success persists to Supabase via `ctx.waitUntil(persistScanToSupabase(...))`.

## Dynamic Sources

The scanner supports four public ATS APIs:
- Greenhouse
- Ashby
- Lever
- SmartRecruiters

Source tokens in `src/worker.js`:

```js
GREENHOUSE_TOKENS = ["gongio", "klaviyo", "datadog", "cloudflare", "hubspot", "pleo", "celonis", "airtable", "gitlab", "figma", "brex", "mercury", "vercel", "typeform", "feedzai", "mentimeter", "trustpilot", "twilio", "asana", "databricks", "mongodb", "elastic", "remote", "sumologic", "contentful", "n26", "cognite", "talkdesk2", "boxinc"]

ASHBY_TOKENS = ["confluent", "deel", "linear", "mollie", "notion", "ramp", "snowflake", "xero"]

LEVER_TOKENS = ["pipedrive"]

SMARTRECRUITERS_TOKENS = ["canva", "wise"]
```

Company aliases normalize non-obvious ATS tokens: `talkdesk2` → `talkdesk`, `boxinc` → `box`.

## ATS Fetching

Each fetcher returns a normalized object: `{ id, title, location, url }`.

- **Greenhouse**: `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=false`
- **Ashby**: `https://api.ashbyhq.com/posting-api/job-board/{token}` — secondary locations expanded into separate postings.
- **Lever**: `https://api.lever.co/v0/postings/{token}?mode=json` — `allLocations` expanded into separate postings.
- **SmartRecruiters**: `https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100&offset={offset}` — paginated up to 10 pages of 100.

## Target Geography

16 countries: `GB`, `IE`, `CA`, `AU`, `US`, `SG`, `DE`, `NL`, `CH`, `SE`, `DK`, `NO`, `ES`, `PT`, `EE`, `NZ`.

Location matching uses two layers:
- `CITY_TO_COUNTRY`: specific city names (London, Dublin, Toronto, Sydney, San Francisco, New York, Seattle, Austin, Berlin, Amsterdam, etc.)
- `COUNTRY_HINTS`: country-level text (United Kingdom, Ireland, Canada, United States, Singapore, etc.)

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

## Visa Classification

Visa likelihood is company-level (not per-posting):

- **Strong**: hubspot, datadog, cloudflare, gitlab, figma, twilio, databricks, mongodb, elastic, confluent, deel, snowflake, xero, canva, wise
- **Likely**: gongio, klaviyo, pleo, celonis, airtable, brex, mercury, vercel, typeform, feedzai, mentimeter, trustpilot, asana, remote, sumologic, contentful, n26, cognite, linear, mollie, notion, ramp, pipedrive, talkdesk, box
- **Unknown**: all others

This is a prioritization heuristic, not a sponsorship guarantee.

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
- **Posting disappeared from successful source** → marked filled with `last_filled`, retained in feed for 7 days, then pruned.
- **Source failed** → previous postings from that source are preserved (no filled markers).
- **>50% boards fail** → scan aborts, KV not written (prevents mass false filled markers).
- **All sources fail** → returns `all_fetch_failed`, KV not written.
- **Retired sources** (`ACTIVE_SOURCES`) → postings from non-active sources are dropped.

## Supabase Persistence

After each successful scan, `persistScanToSupabase()` writes three data sets:

1. **job_postings** — upsert by `id`: master record with `first_seen_date`, `last_seen_date`, `last_filled_date`, `is_active`.
2. **job_snapshots** — upsert by `(job_id, scan_date)`: daily snapshot with title, location, city, country, role_family, seniority, visa, score, tier, `is_new`, `is_filled`.
3. **daily_scan_stats** — upsert by `scan_date`: aggregated counts (total, new, filled, per-source, per-country, per-family, per-tier, ok/fail counts).

This enables trend analysis, market insights, and the `/api/analytics/jobs` endpoint.

## Frontend UI

The entire SPA lives in `public/index.html`. Features:

- **Header**: logo, title, subtitle, last-scan status, login/signup buttons, profile pill (when signed in), theme toggle button.
- **Brand themes**: Cobalt, Graphite (default), Aurora — selectable per-account via profile settings or header toggle.
- **Auth modal**: Google OAuth button + email/password login and signup forms.
- **Onboarding flow**: account type choice (individual/agency), then profile form with target countries/role families.
- **Profile panel**: brand theme switcher, editable individual or agency profile.
- **Tabs**: Live jobs, Visa Roles (SEO route), Targets, My pipeline, Archive, Market Insights (SEO route).
- **Stats cards**: live roles count, new this week, strong visa, top markets, in-pipeline.
- **Filters**: role family, seniority, visa eligibility, country, quick presets (Senior+, Strong visa, New, Starred).
- **Search + sort**: free text search across company/role/family/city/notes, sort by newest, company, role, country, status.
- **Desktop table**: company, role, location, signals (tier/family/seniority/visa badges), apply link, notes, status dropdown.
- **Mobile cards**: responsive card layout replaces table on screens <800px.
- **Pagination**: page buttons with Turnstile human verification gate for page 2+.
- **Pipeline view**: timeline history with event dots (viewed, status_changed, starred, note_added) and time formatting.
- **Anonymous session + tracking**: `lji_session` cookie, event tracking (job_view, search, page_view) to Supabase.
- **Agency banner**: feedback form for agency users.
- **Legend**: score breakdown, badge meanings.
- **Methodology note**: tracking methodology disclaimer.
- **Footer**: social links, contact emails, legal/site links.
- **Empty state**: shown when filters produce no results.

## Tabs

- **Live jobs**: active dynamic postings (not filled, not in pipeline/archive).
- **Targets**: static curated company-location entries from `STATIC_COMPANIES`.
- **My pipeline**: jobs with status Saved, Applied, Recruiter screen, Interview, Final round, Offer.
- **Archive**: jobs with status Rejected, On hold; auto-includes filled dynamic postings not already in another bucket.
- **Visa Roles / Market Insights**: server-rendered SEO pages linking back to SPA.

## Personal State

Job state (status, star, notes) and brand theme sync across devices via Supabase after sign-in. Theme also caches in localStorage (`livejobindex_brand_theme`) for immediate apply on page load.

Statuses: Not started, Saved, Applied, Recruiter screen, Interview, Final round, Offer, Rejected, On hold.

Clicking `Apply` on a live dynamic job auto-moves status from `Not started` or `Saved` to `Applied`. Static target rows use a `Search` button and do not auto-change status.

## Static Curated Targets

`STATIC_COMPANIES` in `public/index.html` contains ~95 curated company-location entries for companies with proprietary, JS-rendered, login-gated, or bot-protected careers pages. These are not live postings — they are careers-search targets.

Examples: Stripe, Salesforce, Google, Meta, AWS/Amazon, Microsoft, Adobe, ServiceNow, Atlassian, Shopify, Personio, Miro, Klarna, Spotify, Zendesk, Pinterest, LinkedIn, and many more across all 16 target countries.

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
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put PAGE_ACCESS_SECRET
npx wrangler secret put ANALYTICS_ALLOWED_EMAILS
```

3. Trigger the first scan:
```bash
curl -H "X-Scan-Key: <your-secret>" "https://livejobindex.com/api/scan-now"
```

For Supabase schema migrations (if changing tables):
```bash
npx supabase migration up
```

## Operational Commands

```bash
npx wrangler tail                          # Tail live logs
npx wrangler kv:key get jobs --binding KV  # Read public jobs payload
npx wrangler kv:key get state --binding KV # Read full scan state
npx wrangler kv:key delete state --binding KV  # Force clean re-scan
curl -H "X-Scan-Key: <SCAN_KEY>" "https://livejobindex.com/api/scan-now"
```

Debug a Greenhouse board:
```bash
curl "https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=false" | jq '.jobs[] | {title, location: .location.name}'
```

## Tests

The test suite (~80 tests, 1260 lines) covers:

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
- Turnstile verification and page access cookie flow
- Auth callback OAuth exchange with `next` parameter preservation
- Onboarding completion validation (individual + agency)
- User job upsert with derived timestamps
- Settings brand theme validation
- Agency feedback auth, validation, and metadata collection
- Supabase scan persistence (upserts to job_postings, job_snapshots, daily_scan_stats)
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

### Add a new Supabase table

1. Create a migration file and apply it: `npx supabase migration new <name>`.
2. Update the schema diagram in Architecture section of this README.
3. If the scanner writes to it, add upsert logic in `persistScanToSupabase()` in `src/worker.js`.
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
- Role matching is title-based; job descriptions are not fetched.
- Turnstile human verification is required for page 2+ of job results; this may add friction for pagination.
- KV is eventually consistent, so very recent writes may take a short time to propagate.
- Cloudflare Email Service is configured as a binding but no email digest is implemented yet.
- The app is optimized for low personal usage, not high-volume public traffic.

## Future Improvements

- Email digest for jobs first seen today (binding already configured).
- CSV/JSON export of job feed.
- Role-description fetching for deeper matching where APIs allow it.
- Separate scoring profiles for RevOps-only vs broad tech roles.
- Public changelog of scanner sources and rule changes.
