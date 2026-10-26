# Scan and application recovery

This runbook requires owner access. Production deployment, resource bindings,
secrets, account operations and retention changes remain owner controlled.
Do not put credentials, private records, queue bodies or generated reports in Git.

## Release gate

Run the contributor verification sequence plus the full `npm audit`. The type
check creates its own ignored directory, including in fresh checkouts. Wrangler
is pinned; Miniflare's Undici is overridden to the patched compatible 7.30.1
release because the current Wrangler release still pins a vulnerable version.
Recheck this override when upgrading Wrangler.

Push the intended changes through review and successful CI. Deploy only the
exact tested master SHA using the protected Production Deployment workflow and
owner environment approval. The September deployment is not repaired by local
changes. An older waiting run is not a substitute for CI on the current master.
Do not bypass the tested-master guard or deploy directly from this checkout.

## Configuration readiness

Check binding names without printing values. Provision secrets through the
GitHub/Cloudflare secret stores. Never copy them into files or logs.

| Worker | Required configuration |
| --- | --- |
| Main | Clerk publishable/server/JWT keys and hosted sign-in/sign-up URLs, `CLERK_WEBHOOK_SECRET`, `SCAN_KEY`, `ANALYTICS_ALLOWED_EMAILS` |
| Main, before Resume Studio validation | `RESUME_STUDIO_ALLOWED_USERS`, `OPENAI_API_KEY`, `AI_GATEWAY_URL`; `AI_GATEWAY_TOKEN` when gateway authentication is enabled |
| Main, before email activation | `UNSUBSCRIBE_SECRET`, configured Email Sending identity |
| Workflow | Its own `CLERK_SECRET_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_URL`; gateway token if required |

Secrets on one Worker do not propagate to the other. Missing lifecycle
credentials now leave deletion retrying before application data is removed.
Validate deletion, session revocation, provider-file removal, R2 removal and
Clerk identity removal with a disposable owner-approved account. Test retries
after the identity has already been removed. Do not use a real customer account.

Keep the existing 0% rollout until owner validation succeeds. The allowlist
permits validation at 0%; zero rollout with an empty allowlist enables nobody.
The owner health endpoint exposes missing main-Worker binding names; verify
Workflow secrets separately. Retire obsolete Supabase credentials only after
the owner confirms there are no external dependencies.

## D1 budget and storage

The existing guarded posting updates, change-only snapshots, bounded snapshot
retention and Durable Object alarms must reach both deployed Workers. Deletes
also cost writes. Do not bulk delete historical snapshots or reset scan history.

Observe a complete scan using `scan_postings_persisted.rows_written` (D1's actual
metadata, including index writes). This measures posting/snapshot batches;
source/run metadata, daily statistics, feed activation, maintenance and account
operations add writes. Reconcile the entire window against Cloudflare D1 daily
and hourly analytics. Batching alone does not lower billed writes.

Reserve at least 25% of the daily write allowance for accounts and cleanup
before increasing retention throughput. Snapshot cleanup remains capped at 250
per maintenance tick, other retention tables at 25 per statement, provider
cleanup at 25 and queued-build recovery at five. Monitor database size daily and
estimate runway from measured growth. Do not assume deletes immediately shrink
allocated storage. If remaining runway is shorter than safe catch-up time,
the owner must choose additional capacity or reduce ingestion; do not raise
cleanup limits without measuring index write costs. Never mass-delete data.

## Source coverage and publication

HubSpot uses the verified `hubspotjobs` Greenhouse board while preserving its
existing application IDs. Pleo now uses its verified Ashby board. LinkedIn's
broken Greenhouse board is removed; the tested SmartRecruiters endpoint returned
an empty feed, so LinkedIn live coverage remains unavailable until an owner
verifies a supported replacement. Static company targets remain targets.
Confluent and Deel empty feeds still require coverage review.

OpenAI has a bounded 20 MiB source-specific JSON limit; other sources retain
8 MiB. `response_too_large` is distinct from invalid JSON. Amazon and Apple visit
every configured location but remain first-page, partial feeds. YC also remains
partial. No partial feed represents exhaustive coverage.

Failed and partial sources carry roles for at most 30 days since verification.
Ageing out removes a role from the public feed without asserting employer
closure. Public job pages and cards expose last verification. Public pages omit
unsupported closing dates and employment type. Saved searches work, but their
alerts are explicitly unavailable; Resume Studio digests are a separate feature.

KV scan completion is a checkpoint. `publication_complete` becomes true only
after D1 posting persistence, R2 upload and transactional feed activation.
Failures leave scan runs `running`; an invocation of the same current-day shard
resumes persistence. Successful sources are skipped on retries, and completed
published shards are no-ops. Old-date retry messages are acknowledged without
scanning under the wrong date. For an unfinished previous-day cycle, investigate
the failure and allow today's coordinated cycle to replace it; never replay an
old scan date with today's upstream content.

## Alerts and dead-letter handling

Configure Cloudflare queue backlog/dead-letter alerts for the existing DLQ and
Worker log alerts for `scan_retry_exhausted`, `coordinated_scan_failed`,
`feed_publication_read_failed`, `stale_scan_enqueue_failed` and lifecycle
failures. Route notifications through the owner's approved operations channel.
Alert on a nonzero DLQ backlog and rising oldest-message age; check often enough
to act before its configured retention expires. Check daily feed freshness after
the final scheduled shard and maintenance continuation. Invocation success alone
does not establish application health.

`/api/status` reads D1/R2 metadata without parsing the full feed. It returns 503
for missing, stale (older than 26 hours) or unpublished feeds and reports
failed/partial coverage explicitly. A current partial feed is degraded but may
still serve with HTTP 200. `/api/admin/health` requires the owner allowlist.
Compare `scan_sources.posting_count` with prior successful scans; it now records
retained jobs instead of an absent `count` field. Investigate a collapse to zero.

There is deliberately no blind DLQ consumer. In the Cloudflare console, inspect
metadata first; inspect private bodies only when necessary and authorized. For
each message, establish type, tenant, current durable state, idempotency key and
whether side effects already completed. Never batch replay unknown messages.

* Expired `scan_retry`: do not replay; use today's coordinator if the feed is stale.
* Completed source/build/revision/lifecycle work: acknowledge without repeating.
* Pending work: repair its dependency, verify its durable identifier and replay
  only that message through the existing queue/Workflow path. Observe completion
  before acknowledging the DLQ copy. Do not fabricate a new idempotency key.
* Email delivery: check the provider receipt and delivery ledger before replay;
  an ambiguous send acknowledgement can otherwise duplicate mail.

Owner approval is required to change queue retention or consumer bindings.
Record operational incident outcomes privately, without publishing payloads.

## Final validation

Owner manual checks cover sign-in, account navigation, saved searches showing
unavailable alerts, stale posting labels, resume upload/build recovery, email
confirmation links, exports and disposable-account deletion. Load-measure feed
listing/SEO CPU and cache hits before choosing a broader feed cache/query redesign.
The status endpoint should be checked independently of invocation analytics.
No browser automation is permitted by the repository instructions.
