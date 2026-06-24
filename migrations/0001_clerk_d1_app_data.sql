PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  full_name TEXT,
  last_login_at TEXT,
  onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0, 1)),
  account_type TEXT NOT NULL DEFAULT 'individual' CHECK (account_type IN ('individual', 'agency')),
  brand_theme TEXT NOT NULL DEFAULT 'graphite' CHECK (brand_theme IN ('cobalt', 'graphite', 'aurora')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  current_title TEXT NOT NULL,
  years_experience REAL NOT NULL CHECK (years_experience >= 0),
  target_role_families TEXT NOT NULL DEFAULT '[]',
  target_seniority TEXT NOT NULL,
  target_countries TEXT NOT NULL DEFAULT '[]',
  visa_needed INTEGER NOT NULL DEFAULT 1 CHECK (visa_needed IN (0, 1)),
  preferred_work_mode TEXT,
  salary_min_usd INTEGER CHECK (salary_min_usd IS NULL OR salary_min_usd >= 0),
  linkedin_url TEXT,
  resume_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agency_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  agency_name TEXT NOT NULL,
  agency_type TEXT NOT NULL CHECK (agency_type IN (
    'recruiting_agency',
    'lead_gen_agency',
    'immigration_consultancy',
    'career_services',
    'market_research',
    'other'
  )),
  target_markets TEXT NOT NULL DEFAULT '[]',
  target_role_families TEXT NOT NULL DEFAULT '[]',
  target_countries TEXT NOT NULL DEFAULT '[]',
  use_case TEXT NOT NULL CHECK (use_case IN (
    'recruiting',
    'lead_generation',
    'visa_market_research',
    'talent_intelligence',
    'job_data_integration',
    'other'
  )),
  integration_interest TEXT NOT NULL DEFAULT 'none' CHECK (integration_interest IN (
    'none',
    'zapier',
    'make',
    'clay',
    'airtable',
    'google_sheets',
    'crm',
    'api',
    'webhook'
  )),
  monthly_data_volume TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_access (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',
  account_type TEXT NOT NULL DEFAULT 'individual' CHECK (account_type IN ('individual', 'agency')),
  api_access_enabled INTEGER NOT NULL DEFAULT 0 CHECK (api_access_enabled IN (0, 1)),
  integrations_enabled INTEGER NOT NULL DEFAULT 0 CHECK (integrations_enabled IN (0, 1)),
  export_enabled TEXT NOT NULL DEFAULT 'none' CHECK (export_enabled IN ('none', 'limited', 'full')),
  rate_limit_tier TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Not started' CHECK (status IN (
    'Not started',
    'Saved',
    'Applied',
    'Recruiter screen',
    'Interview',
    'Final round',
    'Offer',
    'Rejected',
    'On hold'
  )),
  starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  notes TEXT,
  applied_at TEXT,
  saved_at TEXT,
  archived_at TEXT,
  viewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, job_id)
);

CREATE TABLE IF NOT EXISTS user_job_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'viewed',
    'status_changed',
    'starred',
    'note_added'
  )),
  from_status TEXT,
  to_status TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agency_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_name TEXT,
  message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 2000),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_postings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_token TEXT,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  industry TEXT,
  niche TEXT,
  first_seen_date TEXT,
  last_seen_date TEXT,
  last_filled_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  scan_date TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  city TEXT,
  country TEXT,
  industry TEXT,
  niche TEXT,
  role_family TEXT,
  seniority TEXT,
  visa TEXT,
  score INTEGER,
  tier TEXT,
  is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0, 1)),
  is_filled INTEGER NOT NULL DEFAULT 0 CHECK (is_filled IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (job_id, scan_date)
);

CREATE TABLE IF NOT EXISTS daily_scan_stats (
  scan_date TEXT PRIMARY KEY,
  total_jobs INTEGER NOT NULL DEFAULT 0,
  new_jobs INTEGER NOT NULL DEFAULT 0,
  filled_jobs INTEGER NOT NULL DEFAULT 0,
  per_source TEXT NOT NULL DEFAULT '{}',
  per_industry TEXT NOT NULL DEFAULT '{}',
  per_niche TEXT NOT NULL DEFAULT '{}',
  per_country TEXT NOT NULL DEFAULT '{}',
  per_family TEXT NOT NULL DEFAULT '{}',
  per_tier TEXT NOT NULL DEFAULT '{}',
  ok_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anonymous_sessions (
  id TEXT PRIMARY KEY,
  session_token TEXT NOT NULL UNIQUE,
  ip_hash TEXT,
  user_agent_fingerprint TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  job_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'direct',
  viewed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  query_text TEXT,
  filters TEXT NOT NULL DEFAULT '{}',
  result_count INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  page_path TEXT NOT NULL DEFAULT '/',
  referrer TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
CREATE INDEX IF NOT EXISTS user_jobs_user_id_updated_at_idx ON user_jobs (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS user_jobs_user_id_status_idx ON user_jobs (user_id, status);
CREATE INDEX IF NOT EXISTS user_jobs_user_id_viewed_at_idx ON user_jobs (user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS user_job_history_user_job_created_at_idx ON user_job_history (user_id, job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_activity_user_id_created_at_idx ON user_activity (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agency_feedback_user_id_created_at_idx ON agency_feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_postings_company_active_idx ON job_postings (company, is_active);
CREATE INDEX IF NOT EXISTS job_postings_industry_active_idx ON job_postings (industry, is_active);
CREATE INDEX IF NOT EXISTS job_snapshots_scan_date_idx ON job_snapshots (scan_date DESC);
CREATE INDEX IF NOT EXISTS job_snapshots_country_family_idx ON job_snapshots (country, role_family);
CREATE INDEX IF NOT EXISTS job_snapshots_industry_niche_idx ON job_snapshots (industry, niche);
CREATE INDEX IF NOT EXISTS daily_scan_stats_scan_date_idx ON daily_scan_stats (scan_date DESC);
CREATE INDEX IF NOT EXISTS job_views_viewed_at_idx ON job_views (viewed_at DESC);
CREATE INDEX IF NOT EXISTS job_views_job_id_viewed_at_idx ON job_views (job_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS search_queries_created_at_idx ON search_queries (created_at DESC);
CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON page_views (created_at DESC);
