PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS maintenance_leases (
  lease_key TEXT PRIMARY KEY,
  lease_token TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS maintenance_lease_expiry_idx
  ON maintenance_leases (lease_expires_at);
