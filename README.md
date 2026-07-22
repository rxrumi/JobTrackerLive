# Live Job Index

Live Job Index is a Cloudflare-hosted, visa-aware job discovery and application-tracking product. It combines confirmed roles from supported public ATS feeds with clearly labelled company-career targets, authenticated pipeline tools, consented analytics, account export/deletion, and an evidence-grounded Resume Studio.

Runtime data is Cloudflare D1/R2/Queues/Workflows/Durable Objects. Clerk provides identity. Supabase is not used.

## Production architecture

```text
Main Worker (src/worker.js)
├── public SEO: /, /jobs, /visa-roles, /pipeline, /insights
├── public job pages: /jobs/:id/:slug with JobPosting JSON-LD
├── product app: /app/jobs, /app/pipeline, /app/visa-roles,
│                /app/insights, /app/archive, /app/resumes, /app/settings
├── cursor feed: GET /api/jobs and POST /api/jobs/query
├── account/privacy/saved-search APIs
├── five daily scan shards
├── ScanCoordinator, UserMutationCoordinator, RateLimitCoordinator
└── Queue consumer for scan retry, maintenance, Resume Studio, and digests

Workflow Worker (workflow/src/index.js)
├── ResumeBuildWorkflow
└── AccountLifecycleWorkflow (export and deletion)

D1
├── users, onboarding, pipeline, saved searches, consent, analytics
├── scan runs/shards/sources and strongly consistent feed pointer
├── export/deletion workflow state
└── Resume Studio evidence, builds, leases, credits, budgets, notifications

R2
├── JOB_FEEDS: immutable, versioned public feed publications
└── RESUME_FILES: private sources, artifacts, and 24-hour exports

KV
└── legacy scan/feed fallback during the 14-day migration safety window
```

Scan publication is fail-safe: sources succeed independently, failed sources carry forward their last known-good jobs, D1 writes are chunked to at most 50 statements, the immutable R2 feed is written first, and the D1 pointer advances only after persistence succeeds. The prior pointer remains available for rollback.

## Product and API behavior

- Public visitors can read feed page one (15 jobs). A later cursor returns `401 auth_required` with a continuation URL.
- Confirmed job detail pages remain public and crawlable. Filled jobs are retained without active `JobPosting` schema.
- Static targets are company/location career destinations, never represented as confirmed jobs.
- `Live` means active confirmed postings; `Targets` means static destinations; `New` means first seen within seven days; `Saved` means starred; `Applied` means an explicit pipeline state.
- Opening an employer application records a click/view only. It never marks the job Applied.
- All API failures use `{ "error": { "code", "message", "request_id", "details"? } }`.
- Unknown API routes return JSON `404`; unsupported methods return `405` with `Allow`.
- Browser mutations require exact same-origin Fetch Metadata/Origin checks. Clerk webhooks and manual scans use signed exceptions.
- Anonymous identifiers live only in a Secure, HttpOnly, SameSite cookie and are linked server-side after authentication.

Important endpoints:

```text
GET  /api/jobs?limit=15&cursor=...
POST /api/jobs/query
GET  /api/status
GET  /api/admin/health                  owner only

GET|POST /api/privacy/consent
GET|POST /api/saved-searches
PATCH|DELETE /api/saved-searches/:id
GET|PATCH /api/alert-preferences

POST /api/me/export
GET  /api/me/export/:id
GET  /api/me/export/:id/download
DELETE /api/me
GET  /api/me/deletion/:id
POST /api/webhooks/clerk

POST /api/scan-now?shard=0..4           X-Scan-Key required
POST /api/email/unsubscribe?token=...   RFC 8058 one-click
```

## Privacy and retention

Essential storage is always available. GA Consent Mode defaults denied; GA, Microsoft Clarity, and first-party behavioral tracking load only after explicit consent. Global Privacy Control forces denial. Clarity-sensitive input, onboarding, profile, notes, and Resume Studio surfaces are masked.

Retention defaults:

- anonymous raw product analytics: 30 days
- identified raw product analytics: 90 days
- non-identifying aggregates: 13 months
- Google Analytics: two months
- Microsoft Clarity: 30 days
- authenticated account export: 24 hours

Deletion requires authentication less than ten minutes old and a typed confirmation. The workflow marks the account pending, revokes Clerk sessions, fences builds, verifies provider/R2 cleanup, removes identifiable account/analytics data, deletes the Clerk identity, then deletes the D1 user. Only the non-identifying completion ledger remains. Clerk `user.deleted` webhooks enter the same workflow.

## Resume Studio

Resume Studio is rolled out deterministically with `RESUME_ROLLOUT_PERCENT`; owner IDs/emails in `RESUME_STUDIO_ALLOWED_USERS` always remain enabled. Production feature switches enable matching, digests, credit enforcement, and the Studio; auto-build remains opt-in and separately gated.

- one lifetime application-pack credit per verified individual user
- up to three evidence-preserving revisions
- one active build per user and three build attempts per day
- 25 accepted builds/day globally
- estimated OpenAI budget cap of USD 5/day
- capacity and non-ready terminal outcomes do not consume credit
- PDF/DOCX are rendered deterministically in the Worker from canonical JSON
- private R2 artifacts require authenticated tenant ownership
- OpenAI temporary files are deleted in `finally`; unverified cleanup is reconciled by maintenance messages
- all generated claims must trace to verified evidence

Rollout sequence: owner validation, then 1%, 10%, 50%, and 100%, with at least 24 hours between stages. Pause if terminal failures exceed 2%, artifact QA falls below 99%, API 5xx exceeds 1%, cleanup is incomplete, tenant isolation fails, scan publication fails, or the AI budget is unexpectedly exhausted.

## Repository

```text
src/worker.js                main Worker, scans, auth, product APIs, coordinators
src/resume-studio.js         Resume Studio APIs/workflows/credits/digests
src/resume-core.js           deterministic validation, scoring, claim checks
src/resume-renderer.js       Worker-native DOCX/PDF renderer and QA
src/account-lifecycle.js     durable export and deletion operations
workflow/src/index.js        Workflow Worker entrypoint
public/index.html            small app shell (<50 KiB)
public/app.js                vanilla product application
public/targets.js            canonical static company/location targets
public/taxonomy.js           shared countries, role families, and scoring
public/critical.css          extracted shell styles
public/app.css               product/Resume Studio styles
public/consent.js            consented analytics loader
public/legal.css             CSP-safe legal-page styles
migrations/                  additive production D1 migrations
test/                        deterministic backend/frontend-source/lifecycle tests
```

## Local verification

```bash
npm ci
npm audit --omit=dev
npm run build:frontend
npm test
npm run test:migrations
npx wrangler types --check
npx wrangler deploy --dry-run -c workflow/wrangler.toml
npx wrangler deploy --dry-run
```

`npm run verify` runs the production audit, tests, migration validation, and both dry runs. Repository policy deliberately excludes browser, Chrome, Playwright, and other browser automation.

## Production deployment

Configure the resources and secrets documented in `wrangler.toml`, including Clerk, scan, webhook, unsubscribe, owner allowlist, OpenAI, and AI Gateway values. Create the `job-tracker-public-feeds` R2 bucket before first deployment.

Deployment order:

```bash
npm ci
npx wrangler d1 migrations apply job-tracker-app-db --remote
npx wrangler deploy -c workflow/wrangler.toml
npx wrangler deploy
```

Trigger a complete initial scan without deleting KV history:

```bash
for shard in 0 1 2 3 4; do
  curl -X POST -H "X-Scan-Key: <secret>" \
    "https://livejobindex.com/api/scan-now?shard=$shard"
  [ "$shard" = 4 ] || sleep 65
done
```

During migration, dual-write/compare the D1/R2 publication with KV for two complete cycles. Keep KV fallback and the prior feed pointer for 14 days. Roll back with feature flags and the prior D1 pointer; migrations remain additive and production data is never reset.

## Manual browser acceptance checklist

Sohaib performs this checklist on desktop and mobile after automated checks pass:

1. Clerk sign-in/sign-up redirects return to the requested `/app/...` route.
2. Essential-only consent loads no GA/Clarity requests; opt-in loads both; withdrawal and GPC deny analytics.
3. Interrupted onboarding restores on another device and server validation identifies missing fields.
4. Anonymous feed page one works; a later cursor opens sign-in; failed initial loading shows retry rather than an empty feed.
5. Visa Roles always shows Strong/Likely signals; Insights shows aggregates, not job cards.
6. Guest star/status/notes/pipeline/alerts/resume actions open sign-in.
7. Employer links do not mark Applied; explicit status, notes, saved searches, alerts, and rollback behavior work.
8. Mobile navigation exposes Jobs, Visa, Targets, Pipeline, Archive, Insights, Resume, and Settings.
9. Export reaches Ready and downloads a private ZIP; deletion enforces recent auth, becomes pending, and completes.
10. Resume upload, evidence verification, one-credit confirmation, build polling, PDF/DOCX download, revisions, digest, and one-click unsubscribe work.
11. Keyboard focus, dialog restoration, tab arrows, live errors, reduced motion, labels, contrast, and empty/loading states are usable.

## Known product limits

- Proprietary, login-gated, bot-protected, and unreliable ATS pages remain static targets.
- Role matching is title-based unless a job is hydrated for Resume Studio.
- Visa classification is a company-level prioritization heuristic, not a sponsorship fact or immigration advice.
- There is no payment system; Cloudflare usage is designed for free-tier constraints and OpenAI usage is service-managed and capped.
