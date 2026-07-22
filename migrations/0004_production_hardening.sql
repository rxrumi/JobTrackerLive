PRAGMA foreign_keys = ON;

-- Additive production-hardening migration. Existing rows remain valid and are
-- backfilled to the lifecycle state represented by the legacy onboarding flag.
ALTER TABLE users ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'pending_onboarding'
  CHECK (lifecycle_state IN ('pending_onboarding', 'active', 'deletion_pending', 'deleted'));
ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE users ADD COLUMN analytics_consent INTEGER NOT NULL DEFAULT 0
  CHECK (analytics_consent IN (0, 1));
ALTER TABLE users ADD COLUMN analytics_consent_updated_at TEXT;

UPDATE users
SET lifecycle_state = CASE WHEN onboarding_completed = 1 THEN 'active' ELSE 'pending_onboarding' END;

ALTER TABLE anonymous_sessions ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE anonymous_sessions ADD COLUMN consent_state TEXT NOT NULL DEFAULT 'essential'
  CHECK (consent_state IN ('essential', 'analytics'));
ALTER TABLE anonymous_sessions ADD COLUMN expires_at TEXT;

ALTER TABLE job_snapshots ADD COLUMN scan_run_id TEXT;
ALTER TABLE api_idempotency_keys ADD COLUMN request_hash TEXT;
ALTER TABLE resume_builds ADD COLUMN claim_token TEXT;
ALTER TABLE resume_builds ADD COLUMN lease_expires_at TEXT;
ALTER TABLE resume_builds ADD COLUMN provider_cleanup_state TEXT NOT NULL DEFAULT 'not_required'
  CHECK (provider_cleanup_state IN ('not_required', 'pending', 'complete', 'failed'));

CREATE TABLE IF NOT EXISTS privacy_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT,
  policy_version TEXT NOT NULL,
  essential INTEGER NOT NULL DEFAULT 1 CHECK (essential = 1),
  analytics INTEGER NOT NULL DEFAULT 0 CHECK (analytics IN (0, 1)),
  global_privacy_control INTEGER NOT NULL DEFAULT 0 CHECK (global_privacy_control IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query_json TEXT NOT NULL DEFAULT '{}',
  alerts_enabled INTEGER NOT NULL DEFAULT 0 CHECK (alerts_enabled IN (0, 1)),
  last_notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS data_export_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'expired')),
  r2_key TEXT,
  sha256 TEXT,
  byte_size INTEGER,
  failure_code TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retrying', 'complete', 'failed')),
  current_step TEXT NOT NULL DEFAULT 'requested',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  scan_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'complete', 'degraded', 'failed')),
  feed_version TEXT,
  expected_shards INTEGER NOT NULL DEFAULT 5,
  completed_shards INTEGER NOT NULL DEFAULT 0,
  total_jobs INTEGER NOT NULL DEFAULT 0,
  ok_sources INTEGER NOT NULL DEFAULT 0,
  failed_sources INTEGER NOT NULL DEFAULT 0,
  partial_sources INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (scan_date)
);

CREATE TABLE IF NOT EXISTS scan_shards (
  id TEXT PRIMARY KEY,
  scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  shard_index INTEGER NOT NULL CHECK (shard_index BETWEEN 0 AND 4),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'complete', 'degraded', 'failed')),
  ok_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  partial_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (scan_run_id, shard_index)
);

CREATE TABLE IF NOT EXISTS scan_sources (
  id TEXT PRIMARY KEY,
  scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'failed', 'carried_forward')),
  posting_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (scan_run_id, source_id)
);

CREATE TABLE IF NOT EXISTS feed_publications (
  version TEXT PRIMARY KEY,
  scan_run_id TEXT REFERENCES scan_runs(id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  job_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'current', 'retired')),
  created_at TEXT NOT NULL,
  activated_at TEXT
);

CREATE TABLE IF NOT EXISTS feed_pointer (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  current_version TEXT REFERENCES feed_publications(version) ON DELETE RESTRICT,
  previous_version TEXT REFERENCES feed_publications(version) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_file_cleanup (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_file_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, provider_file_id)
);

CREATE TABLE IF NOT EXISTS ai_daily_budgets (
  budget_date TEXT PRIMARY KEY,
  accepted_builds INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS users_lifecycle_state_idx ON users (lifecycle_state, updated_at);
CREATE INDEX IF NOT EXISTS anonymous_sessions_user_idx ON anonymous_sessions (user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS privacy_consents_subject_idx ON privacy_consents (user_id, session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS saved_searches_user_idx ON saved_searches (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS data_exports_user_idx ON data_export_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deletion_requests_user_idx ON account_deletion_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scan_runs_date_status_idx ON scan_runs (scan_date DESC, status);
CREATE INDEX IF NOT EXISTS scan_shards_run_idx ON scan_shards (scan_run_id, shard_index);
CREATE INDEX IF NOT EXISTS scan_sources_run_status_idx ON scan_sources (scan_run_id, status);
CREATE INDEX IF NOT EXISTS feed_publications_status_idx ON feed_publications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_cleanup_due_idx ON provider_file_cleanup (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS resume_builds_lease_idx ON resume_builds (status, lease_expires_at);

