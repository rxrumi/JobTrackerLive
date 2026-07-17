# Resume Studio v1 runbook

Resume Studio is implemented behind feature flags. Do not enable it until the database migration, R2 bucket, Queue, Workflow, renderer Container, AI Gateway, and owner allowlist are ready. The bucket and renderer Worker have no public routes in the main application; candidate downloads always pass through an authenticated tenant-filtered endpoint.

## Resources and deployment order

Create the storage and queues once:

```bash
npx wrangler r2 bucket create job-tracker-resume-files
npx wrangler queues create job-tracker-resume-jobs
npx wrangler queues create job-tracker-resume-jobs-dlq
```

Apply the schema before deploying code that uses it:

```bash
npx wrangler d1 migrations apply job-tracker-app-db --remote
```

Deploy the private renderer first. Docker (or a Docker-compatible engine) must be running because Wrangler builds the LibreOffice/Poppler image:

```bash
npx wrangler deploy --config renderer/wrangler.toml
```

Configure the Workflow's AI credentials and deploy it next:

```bash
npx wrangler secret put OPENAI_API_KEY --config workflow/wrangler.toml
npx wrangler secret put AI_GATEWAY_URL --config workflow/wrangler.toml
npx wrangler secret put AI_GATEWAY_TOKEN --config workflow/wrangler.toml
npx wrangler secret put RESUME_INPUT_COST_PER_MILLION --config workflow/wrangler.toml
npx wrangler secret put RESUME_OUTPUT_COST_PER_MILLION --config workflow/wrangler.toml
npx wrangler deploy --config workflow/wrangler.toml
```

`AI_GATEWAY_URL` is the full OpenAI-compatible gateway base URL, without `/responses` at the end. `REQUIRE_AI_GATEWAY=true` prevents live résumé content from falling back to a direct Responses request when the gateway is missing. Configure the AI Gateway so prompt and response bodies are not persistently logged. Token counts, request/response IDs, prompt version, model, workflow step, and configured cost estimates are still stored in D1.

Configure the main Worker and owner allowlist, then deploy it:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put AI_GATEWAY_URL
npx wrangler secret put AI_GATEWAY_TOKEN
npx wrangler secret put RESUME_STUDIO_ALLOWED_USERS
npx wrangler deploy
```

Source extraction currently runs through the main Worker's Queue consumer, so its OpenAI and AI Gateway credentials are required even though job-specific builds execute in the Workflow.

## Email release prerequisite

Email digests must remain disabled until Cloudflare Email Sending confirms `livejobindex.com` is onboarded:

```bash
npx wrangler email sending list
npx wrangler email sending enable livejobindex.com
```

Review SPF, DKIM, and DMARC in Cloudflare, confirm `updates@livejobindex.com` as the configured sender, and send only to a real test address controlled by the operator. The Worker binding sends transactional digests with HTML and plain-text bodies plus `List-Unsubscribe`. It is not used for outreach or marketing.

The credentials available during implementation could not confirm domain onboarding. Keep `RESUME_EMAIL_DIGESTS_ENABLED=false` until this prerequisite is completed.

## Feature flags and rollout

The committed defaults are deliberately off:

```toml
RESUME_STUDIO_ENABLED = "false"
RESUME_DAILY_MATCHING_ENABLED = "false"
RESUME_AUTO_BUILD_ENABLED = "false"
RESUME_EMAIL_DIGESTS_ENABLED = "false"
CREDIT_ENFORCEMENT_ENABLED = "false"
```

Recommended order:

1. Keep global Studio disabled and add only the owner Clerk user ID or email to `RESUME_STUDIO_ALLOWED_USERS`.
2. Run the seeded unit/migration suite and a real owner import/build with `RESUME_AI_MODE=live` in the Workflow.
3. Confirm the PDF contains selectable text, PDF/DOCX text agreement passes, page count respects the selected target, every claim has verified citations, and exactly one usage event is committed.
4. Enable a small individual-account beta and set `CREDIT_ENFORCEMENT_ENABLED=true`. Each account receives the configurable beta grant once.
5. Enable `RESUME_DAILY_MATCHING_ENABLED` in shadow/notify-only mode.
6. Enable transactional digests only after domain onboarding and unsubscribe testing.
7. Enable `RESUME_AUTO_BUILD_ENABLED` last. User rules remain opt-in and cap automatic builds at one to three per local day.

## Credit behavior

`application_pack` is the only v1 metered feature. The ledger is derived from grants, active reservations, and append-only usage events.

- A build reserves one credit before dispatch.
- The first version that reaches `QA_PASSED` commits one credit.
- Closed jobs, missing evidence, hard blockers, claim-audit blocks, exhausted provider failures, and failed artifact QA release the reservation.
- Duplicate idempotency/equivalence hashes return the existing build.
- Manual editing, restoring, finalizing, and re-exporting do not create another usage charge.
- Provider cost rows record configured estimates; set current per-million-token rates as secrets rather than hard-coding pricing.

## Security and deletion checks

- Never make `job-tracker-resume-files` public or add a public R2 development URL.
- Candidate objects must remain below `users/{user_id}/...`; global public-source snapshots remain below `jobs/{job_id}/{content_hash}/...`.
- All candidate D1 reads and writes include `user_id`; artifact downloads join the authenticated user to both build and artifact.
- PDF/DOCX uploads are limited to 8 MiB and must match extension, MIME, and magic bytes. Macro-enabled Word extensions and unsafe filenames are rejected.
- OpenAI provider files are deleted in a `finally` path after extraction.
- D1 foreign keys cascade candidate data on account deletion. `DELETE /api/me` requires the exact `DELETE MY ACCOUNT` confirmation, terminates known active Workflow instances, deletes the Clerk identity, removes the user's R2 prefix, and then deletes the D1 user row.
- Do not log résumé text, evidence values, job descriptions, canonical JSON, or generated emails.

## Verification

```bash
npm test
npx wrangler deploy --dry-run
npx wrangler deploy --dry-run --config workflow/wrangler.toml
npx wrangler deploy --dry-run --config renderer/wrangler.toml
```

The renderer dry-run invokes the Docker build and therefore requires a running Docker-compatible engine. Browser verification is manual by repository policy; do not add Playwright or Chrome automation.

Before beta, inspect these invariants in D1:

```sql
-- No successful build should have more than one committed credit event.
select build_id, count(*)
from usage_events
where event_type = 'committed'
group by build_id
having count(*) <> 1;

-- No terminal failure should retain a reservation.
select b.id, b.status, r.status
from resume_builds b
join usage_reservations r on r.id = b.credit_reservation_id
where b.status in ('NEEDS_EVIDENCE', 'NEEDS_REVIEW', 'JOB_CLOSED', 'FAILED')
  and r.status = 'reserved';

-- Every ready build needs passed PDF and DOCX artifacts.
select b.id
from resume_builds b
where b.status = 'READY'
  and 2 <> (
    select count(distinct a.format)
    from generated_artifacts a
    where a.build_id = b.id and a.qa_state = 'passed' and a.format in ('pdf', 'docx')
  );
```
