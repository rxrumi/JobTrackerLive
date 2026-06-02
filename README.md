# JobTrackerLive

JobTrackerLive is a cloud-hosted job-search tracker for finding visa-aware technology roles abroad. It combines a curated target-company list with a daily automated scan of public ATS job boards, then presents the results in a searchable, filterable personal pipeline.

The app is built for Sohaib "King" Kazmi, a Dubai-based BizOps Manager / RevOps consultant looking to relocate into international RevOps, BizOps, Sales Ops, Marketing Ops, GTM Ops, strategy, operations, and broader technology-company roles. It prioritizes companies and markets where his HubSpot, Clay, GoHighLevel, n8n, Make, RevOps, and growth-operations background is most relevant.

Live URLs:

- Primary: `https://livejobindex.com`
- WWW: `https://www.livejobindex.com`
- Worker direct: `https://job-tracker.sohaibkazmi-r.workers.dev`

## Purpose

The app exists to reduce the manual work of international job searching.

Instead of repeatedly checking dozens of careers pages, the tracker:

- Scans supported public ATS feeds every day.
- Keeps historical state so newly discovered jobs and recently filled jobs are visible.
- Merges live postings with hand-curated company targets that cannot be reliably scanned.
- Scores roles using visa likelihood, seniority, and freshness.
- Gives one place to search, filter, save, star, and track application status.
- Focuses on relocation-friendly countries and technology companies with a realistic sponsorship or international-hiring profile.

## Who It Is For

Primary user:

- Sohaib "King" Kazmi.
- Dubai-based BizOps Manager / RevOps consultant.
- Looking for relocation opportunities abroad.
- Targeting technology companies where revenue systems, operations, automation, CRM, lifecycle, go-to-market, and growth tooling experience is useful.

Secondary possible users:

- Operators searching across many international tech careers pages.
- Candidates who need a lightweight personal job CRM.
- People targeting companies that use public ATS systems such as Greenhouse, Ashby, Lever, or SmartRecruiters.

## Benefits

For the job search:

- Less repetitive careers-page checking.
- Faster visibility into newly opened jobs.
- Better prioritization of roles that are more likely to be worth applying to.
- Clear distinction between live scanned postings and curated target-company searches.
- One personal application pipeline instead of scattered notes.

For relocation planning:

- Jobs are limited to target countries and cities.
- Visa likelihood is surfaced as a first-class signal.
- Countries are grouped and counted so strong markets are visible quickly.
- Filled roles remain visible briefly, which helps identify hiring patterns even after a posting disappears.

For maintenance:

- Runs on Cloudflare Workers and KV with no server to manage.
- Daily cron is configured in `wrangler.toml`.
- Static UI is served by the same Worker.
- Expected volume fits comfortably on Cloudflare's free tier.

## What The App Does

At a high level, JobTrackerLive has two jobs:

1. Serve the tracker UI.
2. Keep the dynamic job feed fresh.

The UI:

- Loads at `/`.
- Shows live scanned jobs, curated target companies, pipeline jobs, and archived jobs.
- Fetches `/api/jobs` on page load.
- Merges dynamic postings from KV with static curated entries embedded in `public/index.html`.
- Shows job rows in a desktop table.
- Shows mobile-friendly job cards on smaller screens.
- Lets the user filter, search, sort, star, and set status.
- Stores status, stars, onboarding, access, and profile state through Supabase.
- Keeps theme preference in browser `localStorage`.

The cloud scanner:

- Runs daily at `0 3 * * *` UTC.
- Can also be triggered manually through `/api/scan-now`.
- Fetches public ATS APIs in batches of 8 boards.
- Normalizes jobs from each ATS into one common posting shape.
- Filters jobs by target geography and role-family title matching.
- Classifies company tier, visa likelihood, role family, and seniority.
- Computes a score.
- Diffs current results against previous KV state.
- Marks jobs as filled if they disappear from a successful source scan.
- Preserves jobs from a source if that source failed during a partial scan.
- Writes both full state and public payload back to KV.

## Architecture

```text
Cloudflare Worker: job-tracker
├── fetch handler
│   ├── GET /              -> static UI from public/index.html
│   ├── GET /api/jobs      -> public job payload from KV key "jobs"
│   ├── account routes     -> Supabase Auth, onboarding, and user pipeline state
│   └── GET /api/scan-now  -> manual scan, requires X-Scan-Key
└── scheduled handler
    └── runScan(env)       -> scan ATS feeds, filter, score, diff, write KV

Cloudflare KV namespace: job-tracker-state
├── state                  -> full scan state and posting history
└── jobs                   -> flattened payload consumed by the UI

Supabase
├── auth.users             -> email/password identity
├── public.users           -> account type and onboarding state
├── public.user_profiles   -> individual job-seeker profile
├── public.agency_profiles -> agency/data-user profile
├── public.user_jobs       -> per-user status, stars, notes, and timestamps
├── public.user_activity   -> behavior/event log
└── public.account_access  -> plan and gated feature access
```

Configured Cloudflare resources live in `wrangler.toml`:

- Worker name: `job-tracker`
- Main file: `src/worker.js`
- Compatibility date: `2025-04-01`
- Static assets directory: `./public`
- KV binding: `KV`
- KV namespace ID: `8cf95c7c04054745bff09d88ea57d707`
- Cron: `0 3 * * *`
- Custom domains: `livejobindex.com` and `www.livejobindex.com`
- Observability: enabled

## Files

```text
.
├── AGENTS.md              # Codex working context for this repo
├── CLAUDE.md              # Claude-oriented repo context, if used
├── HANDOFF.md             # Operational handoff notes
├── README.md              # Full app documentation
├── package.json           # npm scripts and Wrangler dependency
├── public/index.html      # Self-contained HTML, CSS, and browser JS
├── src/worker.js          # Worker routes, cron handler, scanner, scoring
├── test/worker.test.mjs   # Node test suite for scanner behavior
└── wrangler.toml          # Cloudflare Worker, assets, KV, cron, route config
```

## Runtime Stack

- Cloudflare Workers for compute.
- Cloudflare Workers Assets for the static HTML UI.
- Cloudflare KV for persistent scan state and public job payload.
- Supabase Auth and Postgres for account, onboarding, access, activity, and user-specific pipeline state.
- Wrangler for local development, dry-run validation, deployment, secrets, logs, and KV inspection.
- Plain HTML, CSS, and JavaScript for the frontend.
- Node's built-in `node:test` runner for tests.

There is no separate backend server, frontend build step, or local scanner.

## HTTP Routes

### `GET /`

Serves `public/index.html` through the Worker's assets binding.

The page renders immediately with static curated targets, then fetches dynamic postings from `/api/jobs`.

### `GET /api/jobs`

Returns the latest public dynamic job payload from KV key `jobs`.

Response shape:

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
  "postings": []
}
```

Headers:

- `Cache-Control: public, max-age=300`
- `Access-Control-Allow-Origin: *`

If KV has no `jobs` key yet, the route returns an empty fallback payload with `last_scan`, `last_scan_at`, and `scan_meta` set to `null`.

### Account routes

Supabase-backed account routes are handled by the Worker with HttpOnly session cookies:

- `POST /api/signup`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `PATCH /api/onboarding/account-type`
- `PATCH /api/onboarding/individual-profile`
- `PATCH /api/onboarding/agency-profile`
- `POST /api/onboarding/complete`
- `GET /api/user-jobs`
- `PUT /api/user-jobs/:job_id`
- `POST /api/activity`

These routes require `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the Worker environment. The public job feed remains in Cloudflare KV and does not require authentication.

### `GET /api/scan-now`

Runs the scanner manually.

Authentication:

- Requires request header `X-Scan-Key`.
- The header value must match the Worker secret `SCAN_KEY`.
- Missing or wrong key returns `401 unauthorized`.
- Query-string scan keys are intentionally not accepted.

Success response shape:

```json
{
  "okCount": 40,
  "failCount": 0,
  "total": 26
}
```

Failure responses from the scanner can include:

```json
{ "error": "all_fetch_failed", "okCount": 0, "failCount": 40, "failedSources": [] }
```

```json
{ "error": "too_many_fetch_failures", "okCount": 10, "failCount": 30, "totalBoards": 40, "failedSources": [] }
```

## Scheduled Scan

The cron trigger is configured in `wrangler.toml`:

```toml
[triggers]
crons = ["0 3 * * *"]
```

Cloudflare calls the Worker's `scheduled()` handler, which runs:

```js
ctx.waitUntil(runScan(env));
```

The scheduled scan does the same work as the manual scan endpoint, but without needing an HTTP request.

## Dynamic Sources

The scanner supports four public ATS APIs:

- Greenhouse
- Ashby
- Lever
- SmartRecruiters

Source tokens are configured in `src/worker.js`:

- `GREENHOUSE_TOKENS`
- `ASHBY_TOKENS`
- `LEVER_TOKENS`
- `SMARTRECRUITERS_TOKENS`

Current scanned companies include:

- Greenhouse: Gong, Klaviyo, Datadog, Cloudflare, HubSpot, Pleo, Celonis, Airtable, GitLab, Figma, Brex, Mercury, Vercel, Typeform, Feedzai, Mentimeter, Trustpilot, Twilio, Asana, Databricks, MongoDB, Elastic, Remote, Sumo Logic, Contentful, N26, Cognite, Talkdesk, Box.
- Ashby: Confluent, Deel, Linear, Mollie, Notion, Ramp, Snowflake, Xero.
- Lever: Pipedrive.
- SmartRecruiters: Canva, Wise.

Not every job from those companies is kept. A posting must match both target geography and role-family rules.

## ATS Fetching

Each ATS fetcher returns a normalized lightweight object:

```js
{
  id,
  title,
  location,
  url
}
```

Greenhouse:

```text
https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=false
```

Ashby:

```text
https://api.ashbyhq.com/posting-api/job-board/{token}
```

Ashby secondary locations are expanded into separate posting-location entries.

Lever:

```text
https://api.lever.co/v0/postings/{token}?mode=json
```

Lever `allLocations` are expanded into separate posting-location entries when present.

SmartRecruiters:

```text
https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100&offset={offset}
```

SmartRecruiters is paginated up to 10 pages of 100 postings each.

## Target Geography

The scanner keeps jobs in these countries:

- `GB` United Kingdom
- `IE` Ireland
- `CA` Canada
- `AU` Australia
- `SG` Singapore
- `DE` Germany
- `NL` Netherlands
- `CH` Switzerland
- `SE` Sweden
- `DK` Denmark
- `NO` Norway
- `ES` Spain
- `PT` Portugal
- `EE` Estonia
- `NZ` New Zealand

Location matching uses two layers:

- `CITY_TO_COUNTRY`: city names such as London, Dublin, Toronto, Sydney, Berlin, Amsterdam, Zurich, Stockholm, Copenhagen, Oslo, Barcelona, Lisbon, Tallinn, Auckland, and others.
- `COUNTRY_HINTS`: country-level text such as United Kingdom, UK, Ireland, Canada, Australia, Singapore, Germany, Netherlands, Switzerland, Sweden, Denmark, Norway, Spain, Portugal, Estonia, and New Zealand.

The UI has matching country names and flags in `COUNTRY_NAMES` and `COUNTRY_FLAGS`.

## Role Matching

The scanner classifies job titles into broad professional technology-company role families.

Role families:

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

A job is kept when its title matches one of the configured family keyword lists, or when it matches a generic professional fallback keyword such as engineer, developer, designer, analyst, manager, lead, director, specialist, associate, consultant, architect, or administrator.

The scanner excludes early-career and noisy titles before classification. Excluded title fragments include:

- intern
- internship
- apprentice
- apprenticeship
- graduate program
- graduate scheme
- working student
- student worker
- campus ambassador
- risk, ethics
- advocacy & legal

## Seniority Classification

The scanner infers seniority from title text.

Possible seniority values:

- Executive
- Director/Head
- Senior/Lead
- Manager
- Associate/Analyst
- Unknown

Examples:

- `VP`, `Chief`, `CRO`, `CEO`, `Executive` -> Executive
- `Director`, `Head of`, `Global Head` -> Director/Head
- `Senior`, `Lead`, `Principal`, `Staff` -> Senior/Lead
- `Manager`, `Mgr` -> Manager
- `Associate`, `Analyst`, `Specialist`, `Coordinator`, `Administrator`, `Consultant` -> Associate/Analyst

## Company Classification

Each dynamic posting gets a company tier:

- `Ecosystem`: companies closely aligned with the user's HubSpot, Clay, CRM, RevOps, and GTM tooling background.
- `Scaleup`: growth-stage technology companies.
- `BigTech`: default category for larger or uncategorized technology companies.

Company token aliases normalize ATS tokens that do not match display names. For example:

- `talkdesk2` -> `talkdesk`
- `boxinc` -> `box`

## Visa Classification

The scanner assigns visa likelihood by company, not by individual posting.

Possible values:

- `Strong`
- `Likely`
- `Unknown`

Strong visa companies currently include companies such as HubSpot, Datadog, Cloudflare, GitLab, Figma, Twilio, Databricks, MongoDB, Elastic, Confluent, Deel, Snowflake, Xero, Canva, and Wise.

Likely visa companies include companies such as Gong, Klaviyo, Pleo, Celonis, Airtable, Brex, Mercury, Vercel, Typeform, Feedzai, Mentimeter, Trustpilot, Asana, Remote, Sumo Logic, Contentful, N26, Cognite, Linear, Mollie, Notion, Ramp, Pipedrive, Talkdesk, and Box.

This is a prioritization heuristic. It does not guarantee sponsorship.

## Scoring

Dynamic and frontend scoring use the same current formula:

```js
score = round(visa * 0.5 + seniority * 0.3 + freshness * 0.2)
```

Visa weights:

```js
{
  Strong: 100,
  Likely: 75,
  Unknown: 50
}
```

Seniority weights:

```js
{
  Executive: 95,
  "Director/Head": 90,
  "Senior/Lead": 85,
  Manager: 80,
  "Associate/Analyst": 70,
  Unknown: 65
}
```

Freshness weights:

- Filled jobs: `30`
- Jobs first seen within the last 7 days: `100`
- Older active jobs: `80`

The UI displays scores numerically and with a four-segment score bar:

- High score: `>= 80`
- Medium score: `>= 70`
- Low score: `< 70`

## KV Data Model

The scanner writes two KV keys.

### `state`

Internal scan history:

```json
{
  "last_scan": "2026-06-01",
  "last_scan_at": "2026-06-01T03:00:00.000Z",
  "postings": {
    "greenhouse-hubspot-123": {
      "id": "greenhouse-hubspot-123",
      "source": "greenhouse",
      "source_token": "hubspot",
      "company": "hubspot",
      "title": "Revenue Operations Manager",
      "location": "London, England",
      "city": "London",
      "country": "GB",
      "url": "https://example.com/job",
      "tier": "Ecosystem",
      "role_family": "Operations",
      "seniority": "Manager",
      "visa": "Strong",
      "score": 94,
      "first_seen": "2026-06-01",
      "last_seen": "2026-06-01",
      "last_filled": null
    }
  },
  "scan_meta": {
    "okCount": 40,
    "failCount": 0,
    "totalBoards": 40,
    "okSources": ["greenhouse-hubspot"],
    "failedSources": []
  }
}
```

### `jobs`

Public flattened payload:

```json
{
  "last_scan": "2026-06-01",
  "last_scan_at": "2026-06-01T03:00:00.000Z",
  "scan_meta": {},
  "postings": []
}
```

This is what `/api/jobs` returns to the browser.

## Diffing And Filled Jobs

The scanner compares the current scan to the previous `state.postings`.

If a previous posting is found again:

- It keeps the original `first_seen`.
- It updates `last_seen`.
- It clears `last_filled`.

If a previous posting disappears from a source that scanned successfully:

- It is marked filled with `last_filled`.
- It remains in the public feed for 7 days.
- After 7 days it is pruned.

If a source fails:

- Previous postings from that source are preserved.
- They are not marked filled because the scanner cannot know whether the jobs disappeared or the source failed.

If more than half of all boards fail:

- The scan aborts.
- KV is not written.
- This prevents a bad network day from marking many valid jobs as filled.

If all sources fail:

- The scan returns `all_fetch_failed`.
- KV is not written.

Postings from retired/non-active sources are dropped during regenerated cloud scans.

## Frontend UI

The entire frontend lives in `public/index.html`.

The UI includes:

- Header with app title, subtitle, last scan timestamp, and theme toggle.
- Tabs for:
  - Live jobs
  - Targets
  - My pipeline
  - Archive
- Stat cards for:
  - Live roles
  - New this week
  - Strong visa
  - Top markets
  - In pipeline
- Country count pills.
- Filter dropdowns.
- Quick preset chips.
- Search input.
- Sort dropdown.
- Reset button.
- Desktop table view.
- Mobile card view.
- Score and badge legend.
- Empty state when filters return no results.

## Tabs

`Live jobs`:

- Dynamic postings from the ATS scan.
- Excludes filled jobs.
- Excludes jobs moved into the personal pipeline or archive by status.

`Targets`:

- Static curated company-location entries from `STATIC_COMPANIES`.
- These are careers-search links or hand-picked target pages.
- They represent companies worth checking even when their ATS cannot be scanned reliably.

`My pipeline`:

- Jobs whose browser-local status is one of:
  - Saved
  - Applied
  - Recruiter screen
  - Interview
  - Final round
  - Offer

`Archive`:

- Jobs whose browser-local status is:
  - Rejected
  - On hold
- Filled dynamic jobs also appear here unless they are already in another status bucket.

## Filters

Filter categories:

- Country
- Role family
- Visa
- Seniority
- Company tier

Preset filters:

- Senior+
- Strong visa
- New
- Starred

Search matches:

- Company
- Role
- Family label
- Seniority label
- City
- Notes
- Tier label

Sorting options:

- Score descending
- Score ascending
- Company A-Z
- Role A-Z
- Country
- Status

Starred jobs are always sorted above unstarred jobs.

## Job Badges

Source badges:

- `LIVE`: dynamic ATS posting confirmed by scan.
- `TARGET`: static curated company careers target.

Lifecycle badges:

- `NEW`: first seen within 7 days and not filled.
- `FILLED`: disappeared from a successfully scanned source and retained temporarily.

Signal badges:

- Company tier: Big Tech, Scale-up, or HubSpot/Clay ecosystem.
- Role family.
- Seniority.
- Visa likelihood.

## Personal State

The app stores personal job state in Supabase after sign-in.

Stored values:

- `user_jobs.status`
- `user_jobs.starred`
- `user_jobs.notes`
- `user_jobs.saved_at`
- `user_jobs.applied_at`
- `user_jobs.archived_at`
- Theme remains browser-local as `jobtrack-theme`

Statuses:

- Not started
- Saved
- Applied
- Recruiter screen
- Interview
- Final round
- Offer
- Rejected
- On hold

When the user clicks `Apply` for a live dynamic job, the app automatically moves status from `Not started` or `Saved` to `Applied`.

Static target rows use a `Search` button instead of `Apply` and do not auto-change status.

Because this state is stored in Supabase, it syncs across browsers after the user signs in.

## Static Curated Targets

`STATIC_COMPANIES` in `public/index.html` contains curated company-location entries. These are not live postings. They are target companies or filtered careers-search pages worth checking manually.

Static entries exist because many valuable companies use:

- Proprietary careers systems.
- JavaScript-rendered pages.
- Login-gated systems.
- Bot-protected pages.
- ATS APIs that are not public or stable.

Examples include companies such as Stripe, Salesforce, Google, Meta, AWS / Amazon, Microsoft, Adobe, ServiceNow, Atlassian, Shopify, Personio, Miro, Klarna, Spotify, Zendesk, Pinterest, LinkedIn, and others.

Static rows are deduplicated by:

```text
company | country | city
```

Static rows use:

- Role: `Company career target`
- Role family: `Multiple`
- Seniority: `Any`
- Notes: curated careers search by country

## Local Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

This starts Wrangler dev for the Worker and assets.

Run tests:

```bash
npm test
```

Validate deployment without pushing:

```bash
npx wrangler deploy --dry-run
```

## Deployment

Login to Cloudflare:

```bash
npx wrangler login
```

Apply Supabase schema:

```bash
npx supabase migration up
```

Set Supabase Worker secrets:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
```

Deploy:

```bash
npm run deploy
```

or:

```bash
npx wrangler deploy
```

Set the manual scan secret:

```bash
npx wrangler secret put SCAN_KEY
```

Trigger the first scan:

```bash
curl -H "X-Scan-Key: <your-secret>" "https://job-tracker.sohaibkazmi-r.workers.dev/api/scan-now"
```

## Operational Commands

Tail live Worker logs:

```bash
npx wrangler tail
```

Read public jobs payload:

```bash
npx wrangler kv:key get jobs --binding KV
```

Read full scan state:

```bash
npx wrangler kv:key get state --binding KV
```

Force a clean re-scan:

```bash
npx wrangler kv:key delete state --binding KV
curl -H "X-Scan-Key: <SCAN_KEY>" "https://job-tracker.sohaibkazmi-r.workers.dev/api/scan-now"
```

Debug a Greenhouse board:

```bash
curl "https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=false" | jq '.jobs[] | {title, location: .location.name}'
```

## Tests

The test suite covers key scanner behavior:

- Location matching with lowercase and country-hint locations.
- Visa classification.
- Company alias normalization.
- Broad role-family classification.
- Early-career and noisy-title exclusion.
- Preservation of previous postings when a source fails.
- Dropping postings from retired sources.
- Aborting KV writes when too many sources fail.
- Manual scan auth with `X-Scan-Key`.
- Account route authentication.
- Onboarding completion validation.
- User job state upsert behavior.

Run:

```bash
npm test
```

## Common Changes

### Add a new public ATS company

1. Add the company token to one of:
   - `GREENHOUSE_TOKENS`
   - `ASHBY_TOKENS`
   - `LEVER_TOKENS`
   - `SMARTRECRUITERS_TOKENS`
2. Add a `COMPANY_ALIASES` entry if the token is not the real display/classification name.
3. Add the company to `HIGH_FIT_COMPANIES`, `ECOSYSTEM_COMPANIES`, `SCALEUP_COMPANIES`, `STRONG_VISA_COMPANIES`, or `LIKELY_VISA_COMPANIES` if applicable.
4. Run tests.
5. Deploy.

### Add a new target country or city

1. Update `CITY_TO_COUNTRY` in `src/worker.js`.
2. Add country-level text to `COUNTRY_HINTS` if needed.
3. Update `COUNTRY_NAMES` in `public/index.html`.
4. Update `COUNTRY_FLAGS` in `public/index.html`.
5. Run tests.
6. Deploy.

### Change role matching

Update `ROLE_FAMILIES`, `ROLE_FALLBACK_KEYWORDS`, or `EXCLUDED_TITLE_KEYWORDS` in `src/worker.js`.

If the UI's fallback inference should match, also update `inferRoleFamily()` in `public/index.html`.

### Change scoring

Update `calcScore()` in both:

- `src/worker.js`
- `public/index.html`

Keeping both formulas aligned matters because dynamic postings are scored by the Worker and static frontend rows are scored in the browser.

### Add a static curated target

Add an entry to `STATIC_COMPANIES` in `public/index.html`:

```js
{
  id: 96,
  company: 'ExampleCo',
  country: 'GB',
  city: 'London',
  tier: 'Scaleup',
  visa: 'Likely',
  apply: 'https://example.com/careers?location=London'
}
```

Use static entries for companies that are important but cannot be scanned reliably.

## Known Limits

- The app only scans public ATS APIs that are explicitly supported.
- Proprietary, JavaScript-rendered, login-gated, and bot-protected careers sites are not scanned.
- Static target entries are not live postings.
- Visa classification is heuristic and company-level.
- Role matching is title-based; it does not inspect job descriptions.
- `content=false` is used for Greenhouse, so description text is not fetched.
- Theme is stored in browser `localStorage`.
- There is no email digest yet.
- KV is eventually consistent, so very recent writes may take a short time to appear everywhere.
- The app is optimized for low personal usage, not high-volume public traffic.

## Future Improvements

Possible next steps:

- Add `POST /api/status` so status and stars sync across devices.
- Add email digest for jobs first seen today.
- Add a manual "hide" action for irrelevant postings.
- Add per-company notes.
- Add CSV export.
- Add role-description fetching for deeper matching where APIs allow it.
- Add separate scoring profiles for RevOps-only versus broad tech roles.
- Add a public changelog of scanner sources and rule changes.
