# JobTrackerLive — contributor agent instructions

## Repository status

Live Job Index is source-available, not open source. Read `LICENSE.md` and
`CONTRIBUTING.md` before making changes. Local execution and temporary forks
are permitted only for evaluation and preparing contributions. Production
deployment is owner-controlled.

Do not add credentials, production data, private resumes, user information, or
generated reports to commits, issues, tests, or logs. Do not change licensing,
branding, deployment ownership, or production resource bindings unless the
repository owner explicitly requests it.

## Architecture

Live Job Index is a Cloudflare application with two Workers:

- `src/worker.js`: public pages, APIs, ATS scans, auth, queues, Durable Objects,
  D1/R2/KV publication, account lifecycle entrypoints, and static assets.
- `workflow/src/index.js`: Resume Build and Account Lifecycle Workflows.

Clerk provides identity. Runtime data uses Cloudflare D1, R2, Queues,
Workflows, Durable Objects, and a temporary KV migration fallback. Supabase is
not used; do not add Supabase runtime code unless explicitly requested.

Key supporting areas:

- `src/resume-studio.js`: evidence, builds, credits, matching, notifications.
- `src/resume-core.js`: deterministic validation, scoring, and claim checks.
- `src/resume-renderer.js`: Worker-native PDF/DOCX rendering and QA.
- `src/account-lifecycle.js`: durable export and deletion operations.
- `public/`: app shell, frontend modules, legal/SEO assets, taxonomy, targets.
- `migrations/`: additive D1 migrations.
- `test/`: deterministic backend, frontend-source, migration, and lifecycle tests.

## Invariants

- Static company/location targets are not confirmed live postings.
- Role, seniority, and scoring fallbacks must stay aligned between Worker and
  frontend code.
- Visa labels are company-level prioritization heuristics, not guarantees or
  immigration advice.
- Opening an employer link never marks a job as Applied.
- Browser mutations require same-origin checks; webhooks and manual scans use
  signed exceptions.
- Tenant-owned D1/R2 data must never be accessible across users.
- Resume claims must trace to verified evidence.
- Migrations are additive. Never reset, delete, or destructively rewrite
  production data or KV scan history.
- Production secrets remain in GitHub/Cloudflare secret stores only.

## Working rules

- Preserve unrelated user changes in a dirty worktree.
- Use `rg`/`rg --files` for repository searches and `apply_patch` for edits.
- Update deterministic tests with behavior changes.
- Keep pull requests focused and document user-visible and operational risk.
- Do not run browser, Chrome, Playwright, or in-app Browser checks. The owner
  performs manual browser verification.

## Verification

Run the full unprivileged verification sequence:

```bash
npm ci
npm run build:frontend
git diff --exit-code -- public
npm audit --omit=dev
npm test
npm run test:migrations
npm run check:types
npm run check:deploy
```

Pull requests receive no deployment or application secrets. A successful PR
check does not deploy. Only the exact tested `master` commit can enter the
protected production deployment, which requires owner approval.
