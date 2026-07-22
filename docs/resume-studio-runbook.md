# Resume Studio production runbook

Resume Studio uses the Workflow Worker, D1, private R2, Queues, AI Gateway/OpenAI, Email Sending, and the main Worker's `UserMutationCoordinator`. PDF and DOCX generation is Worker-native; there is no Container or Docker deployment.

## Provisioning and secrets

Provision the resources named in `wrangler.toml` and `workflow/wrangler.toml`:

- D1 `job-tracker-app-db`
- private R2 `job-tracker-resume-files`
- public immutable-feed R2 `job-tracker-public-feeds`
- `job-tracker-resume-jobs` plus its DLQ
- Email Sending binding
- Resume Build and Account Lifecycle Workflows
- three Durable Object namespaces on the main Worker

Set `OPENAI_API_KEY`, `AI_GATEWAY_URL`, optional `AI_GATEWAY_TOKEN`, `RESUME_STUDIO_ALLOWED_USERS`, `UNSUBSCRIBE_SECRET`, and the Clerk secrets. AI Gateway logging must not retain request or response bodies.

## Deploy and verify

```bash
npm ci
npm audit --omit=dev
npm test
npm run test:migrations
npx wrangler types --check
npx wrangler d1 migrations apply job-tracker-app-db --remote
npx wrangler deploy --dry-run -c workflow/wrangler.toml
npx wrangler deploy --dry-run
npx wrangler deploy -c workflow/wrangler.toml
npx wrangler deploy
```

The Workflow Worker deploys before the main Worker. Browser verification stays manual under repository policy.

## Controls

- one lifetime application-pack credit per verified individual user
- one active build/user; three attempts/user/day
- 25 accepted builds/day globally
- USD 5/day estimated AI budget
- up to three revisions within a pack
- 10 MiB PDF/DOCX upload ceiling
- DOCX macro, signature, entry-count, expansion-size, and compression-ratio validation
- claim provenance, ATS, page-count, checksum, structure, and file-size QA before Ready
- credit reserved before dispatch and committed only at Ready
- terminal failure, expiry, or capacity rejection releases the reservation
- provider files deleted in `finally` and reconciled by maintenance queue messages

Auto-build is off by default. A rule must explicitly select it, the account must acknowledge that it can use the sole pack credit, and `RESUME_AUTO_BUILD_ENABLED` must be enabled.

## Rollout

`RESUME_STUDIO_ALLOWED_USERS` bypasses percentage gating for owner validation. All other verified users are assigned deterministically by `RESUME_ROLLOUT_PERCENT`.

1. Owner validation at 0%.
2. Set 1%; observe at least 24 hours.
3. Set 10%; observe at least 24 hours.
4. Set 50%; observe at least 24 hours.
5. Set 100%.

Pause or roll back when terminal failures exceed 2%, artifact QA is below 99%, API 5xx exceeds 1%, cleanup is incomplete, tenant isolation fails, scan publication fails, or AI budget exhaustion is unexpected. Percentage and feature-flag rollback does not delete data.

## Operational queries

```sql
-- Daily capacity and budget
select * from ai_daily_budgets order by budget_date desc limit 14;

-- Builds requiring attention
select status, failure_code, count(*)
from resume_builds
where created_at >= datetime('now','-1 day')
group by status, failure_code;

-- Credit must commit once at most
select build_id, count(*) as commits
from usage_events
where event_type = 'committed'
group by build_id
having count(*) > 1;

-- Provider cleanup backlog
select status, count(*), max(attempt_count)
from provider_file_cleanup
group by status;

-- Artifact QA rate
select qa_state, count(*) from generated_artifacts
where created_at >= datetime('now','-1 day')
group by qa_state;
```

If a build stalls, inspect its `claim_token`, `lease_expires_at`, workflow instance, reservation, and provider cleanup rows. Retry only retryable infrastructure failures; never retry terminal builds. If deletion is pending, do not manually resume AI/artifact work.

## Email and unsubscribe

Digests are scheduled by delayed Queue messages at each rule's local hour, not by an extra cron. Delivery is idempotent. Every email includes signed, expiring RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post` headers. The public unsubscribe endpoint requires no login and disables email delivery while leaving in-app notifications available.
