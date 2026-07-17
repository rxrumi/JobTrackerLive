PRAGMA foreign_keys = ON;

-- Resume Studio stores candidate-owned data separately from globally reusable job content.
-- JSON values are stored as TEXT and validated at the application boundary so D1 remains
-- compatible with Cloudflare's production SQLite version.

CREATE TABLE IF NOT EXISTS resume_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  safe_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
  sha256 TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  extraction_state TEXT NOT NULL DEFAULT 'pending' CHECK (extraction_state IN (
    'pending', 'processing', 'complete', 'failed', 'deleted'
  )),
  extraction_error TEXT,
  provider_file_id TEXT,
  extracted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (user_id, sha256)
);

CREATE TABLE IF NOT EXISTS candidate_evidence (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES resume_sources(id) ON DELETE SET NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'contact', 'employment', 'achievement', 'skill', 'tool', 'education',
    'certification', 'project', 'language', 'other'
  )),
  verification_state TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_state IN (
    'unverified', 'verified', 'rejected'
  )),
  canonical_value TEXT NOT NULL DEFAULT '{}',
  employer TEXT,
  title TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  skills TEXT NOT NULL DEFAULT '[]',
  metrics TEXT NOT NULL DEFAULT '[]',
  prohibited_inferences TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, evidence_type, content_hash)
);

CREATE TABLE IF NOT EXISTS resume_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_role_family TEXT NOT NULL,
  target_seniority TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  page_target INTEGER NOT NULL DEFAULT 1 CHECK (page_target IN (1, 2)),
  template TEXT NOT NULL DEFAULT 'classic' CHECK (template IN ('classic', 'compact', 'modern')),
  target_headline TEXT,
  summary_guidance TEXT,
  evidence_order TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS resume_profile_evidence (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES resume_profiles(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES candidate_evidence(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, profile_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS job_contents (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  source_snapshot_r2_key TEXT,
  normalized_text TEXT,
  hydration_status TEXT NOT NULL DEFAULT 'pending' CHECK (hydration_status IN (
    'pending', 'hydrating', 'ready', 'unsupported', 'failed', 'closed'
  )),
  source_status_code INTEGER,
  source_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  hydrated_at TEXT,
  checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (job_id, content_hash)
);

CREATE TABLE IF NOT EXISTS job_requirement_snapshots (
  id TEXT PRIMARY KEY,
  job_content_id TEXT NOT NULL REFERENCES job_contents(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  requirements_json TEXT NOT NULL,
  hard_blockers_json TEXT NOT NULL DEFAULT '[]',
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  response_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (content_hash, prompt_version, model)
);

CREATE TABLE IF NOT EXISTS custom_job_inputs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  company TEXT,
  job_url TEXT,
  normalized_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  extraction_state TEXT NOT NULL DEFAULT 'ready' CHECK (extraction_state IN (
    'pending', 'ready', 'needs_pasted_text', 'failed'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, content_hash)
);

CREATE TABLE IF NOT EXISTS billing_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT,
  external_customer_id TEXT,
  external_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'beta',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlement_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  billing_account_id TEXT REFERENCES billing_accounts(id) ON DELETE SET NULL,
  feature_key TEXT NOT NULL DEFAULT 'application_pack',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source TEXT NOT NULL CHECK (source IN ('beta', 'subscription', 'credit_pack', 'promotion', 'admin')),
  external_reference TEXT,
  starts_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, feature_key, source, external_reference)
);

CREATE TABLE IF NOT EXISTS usage_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL DEFAULT 'application_pack',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released', 'expired')),
  expires_at TEXT NOT NULL,
  release_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, feature_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS resume_builds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES job_postings(id) ON DELETE SET NULL,
  custom_job_input_id TEXT REFERENCES custom_job_inputs(id) ON DELETE SET NULL,
  profile_id TEXT NOT NULL REFERENCES resume_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
    'QUEUED', 'JOB_REVALIDATION', 'REQUIREMENTS_READY', 'EVIDENCE_SELECTED',
    'RESUME_GENERATED', 'CLAIM_AUDITED', 'EMAIL_GENERATED', 'RENDERING',
    'QA_PASSED', 'READY', 'NEEDS_EVIDENCE', 'NEEDS_REVIEW', 'JOB_CLOSED', 'FAILED'
  )),
  generation_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  equivalence_hash TEXT NOT NULL,
  fit_score INTEGER,
  fit_breakdown TEXT,
  coverage_score INTEGER,
  coverage_breakdown TEXT,
  ats_readiness TEXT,
  keyword_analysis TEXT,
  hard_blockers TEXT NOT NULL DEFAULT '[]',
  credit_reservation_id TEXT REFERENCES usage_reservations(id) ON DELETE SET NULL,
  selected_evidence_ids TEXT NOT NULL DEFAULT '[]',
  failure_code TEXT,
  failure_detail TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  auto_build INTEGER NOT NULL DEFAULT 0 CHECK (auto_build IN (0, 1)),
  build_rule_id TEXT REFERENCES build_rules(id) ON DELETE SET NULL,
  auto_build_local_date TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((job_id IS NOT NULL AND custom_job_input_id IS NULL) OR (job_id IS NULL AND custom_job_input_id IS NOT NULL)),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (user_id, equivalence_hash)
);

CREATE TABLE IF NOT EXISTS resume_build_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES resume_builds(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  version_kind TEXT NOT NULL CHECK (version_kind IN ('ai_generation', 'manual_finalize', 'revision', 'restore')),
  canonical_resume_json TEXT NOT NULL,
  email_json TEXT,
  audit_results TEXT,
  draft_snapshot TEXT,
  source_version_id TEXT REFERENCES resume_build_versions(id) ON DELETE SET NULL,
  model TEXT,
  prompt_version TEXT,
  request_id TEXT,
  response_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, build_id, version_number)
);

CREATE TABLE IF NOT EXISTS resume_build_drafts (
  build_id TEXT PRIMARY KEY REFERENCES resume_builds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  based_on_version_id TEXT REFERENCES resume_build_versions(id) ON DELETE SET NULL,
  canonical_resume_json TEXT NOT NULL,
  email_json TEXT,
  revision_number INTEGER NOT NULL DEFAULT 0,
  ai_revision_count INTEGER NOT NULL DEFAULT 0 CHECK (ai_revision_count BETWEEN 0 AND 3),
  pending_ai_instruction TEXT,
  pending_ai_version_id TEXT REFERENCES resume_build_versions(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, build_id)
);

CREATE TABLE IF NOT EXISTS generated_artifacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES resume_builds(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES resume_build_versions(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('pdf', 'docx', 'qa_json', 'preview_html')),
  r2_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  page_count INTEGER,
  qa_state TEXT NOT NULL DEFAULT 'pending' CHECK (qa_state IN ('pending', 'passed', 'failed')),
  qa_results TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, build_id, version_id, format)
);

CREATE TABLE IF NOT EXISTS build_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  role_families TEXT NOT NULL DEFAULT '[]',
  countries TEXT NOT NULL DEFAULT '[]',
  seniority TEXT NOT NULL DEFAULT '[]',
  visa_requirement TEXT NOT NULL DEFAULT 'any' CHECK (visa_requirement IN ('any', 'likely', 'strong')),
  minimum_fit_score INTEGER NOT NULL DEFAULT 70 CHECK (minimum_fit_score BETWEEN 0 AND 100),
  action TEXT NOT NULL DEFAULT 'notify_only' CHECK (action IN ('notify_only', 'auto_build')),
  daily_auto_build_cap INTEGER NOT NULL DEFAULT 1 CHECK (daily_auto_build_cap BETWEEN 1 AND 3),
  profile_id TEXT REFERENCES resume_profiles(id) ON DELETE SET NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  notification_delivery TEXT NOT NULL DEFAULT 'in_app' CHECK (notification_delivery IN ('in_app', 'in_app_email')),
  digest_local_hour INTEGER NOT NULL DEFAULT 8 CHECK (digest_local_hour BETWEEN 0 AND 23),
  email_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (email_opt_in IN (0, 1)),
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'new_job_match', 'build_ready', 'build_needs_review', 'build_failed',
    'job_closed', 'evidence_needed', 'credit_low'
  )),
  event_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  job_id TEXT REFERENCES job_postings(id) ON DELETE SET NULL,
  build_id TEXT REFERENCES resume_builds(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'dismissed', 'actioned')),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, event_key)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id TEXT REFERENCES notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email_digest')),
  digest_date TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'suppressed')),
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  sent_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, channel, idempotency_key),
  UNIQUE (user_id, notification_id, channel)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservation_id TEXT REFERENCES usage_reservations(id) ON DELETE SET NULL,
  build_id TEXT REFERENCES resume_builds(id) ON DELETE SET NULL,
  feature_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('committed', 'released', 'adjustment')),
  quantity INTEGER NOT NULL CHECK (quantity <> 0),
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS provider_cost_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  build_id TEXT REFERENCES resume_builds(id) ON DELETE SET NULL,
  version_id TEXT REFERENCES resume_build_versions(id) ON DELETE SET NULL,
  workflow_step TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  request_id TEXT,
  response_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, request_id, workflow_step)
);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  processed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, external_event_id)
);

CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (user_id, scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS resume_sources_user_created_idx ON resume_sources (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS candidate_evidence_user_state_type_idx ON candidate_evidence (user_id, verification_state, evidence_type);
CREATE INDEX IF NOT EXISTS resume_profiles_user_default_idx ON resume_profiles (user_id, is_default DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS resume_profile_evidence_profile_position_idx ON resume_profile_evidence (user_id, profile_id, position);
CREATE INDEX IF NOT EXISTS job_contents_job_status_idx ON job_contents (job_id, hydration_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS job_contents_hash_idx ON job_contents (content_hash);
CREATE INDEX IF NOT EXISTS job_requirements_hash_idx ON job_requirement_snapshots (content_hash, prompt_version, model);
CREATE INDEX IF NOT EXISTS custom_jobs_user_created_idx ON custom_job_inputs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS resume_builds_user_status_idx ON resume_builds (user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS resume_builds_job_profile_idx ON resume_builds (user_id, job_id, profile_id);
CREATE INDEX IF NOT EXISTS resume_builds_rule_day_idx ON resume_builds (user_id, build_rule_id, auto_build_local_date);
CREATE INDEX IF NOT EXISTS resume_build_versions_build_version_idx ON resume_build_versions (user_id, build_id, version_number DESC);
CREATE INDEX IF NOT EXISTS resume_build_drafts_user_updated_idx ON resume_build_drafts (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS generated_artifacts_build_idx ON generated_artifacts (user_id, build_id, version_id);
CREATE INDEX IF NOT EXISTS build_rules_user_enabled_idx ON build_rules (user_id, enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_status_idx ON notifications (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx ON notification_deliveries (channel, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS entitlements_user_feature_idx ON entitlement_grants (user_id, feature_key, starts_at, expires_at);
CREATE INDEX IF NOT EXISTS usage_reservations_user_status_idx ON usage_reservations (user_id, feature_key, status, expires_at);
CREATE INDEX IF NOT EXISTS usage_events_user_feature_idx ON usage_events (user_id, feature_key, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_cost_build_idx ON provider_cost_events (user_id, build_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_idempotency_expiry_idx ON api_idempotency_keys (expires_at);
