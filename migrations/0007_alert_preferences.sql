PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS alert_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  alerts_enabled INTEGER NOT NULL DEFAULT 0 CHECK (alerts_enabled IN (0, 1)),
  delivery TEXT NOT NULL DEFAULT 'daily' CHECK (delivery IN ('immediate', 'daily', 'weekly')),
  local_hour INTEGER NOT NULL DEFAULT 8 CHECK (local_hour BETWEEN 0 AND 23),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS alert_preferences_delivery_idx
  ON alert_preferences (alerts_enabled, delivery, local_hour);

CREATE TRIGGER IF NOT EXISTS provider_cost_events_tenant_insert
BEFORE INSERT ON provider_cost_events
BEGIN
  SELECT RAISE(ABORT, 'provider_cost_build_tenant_mismatch')
    WHERE NEW.build_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM resume_builds b WHERE b.id = NEW.build_id AND b.user_id = NEW.user_id);
  SELECT RAISE(ABORT, 'provider_cost_version_tenant_mismatch')
    WHERE NEW.version_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM resume_build_versions v WHERE v.id = NEW.version_id AND v.user_id = NEW.user_id);
END;

CREATE TRIGGER IF NOT EXISTS notification_deliveries_tenant_insert
BEFORE INSERT ON notification_deliveries
BEGIN
  SELECT RAISE(ABORT, 'notification_delivery_tenant_mismatch')
    WHERE NEW.notification_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM notifications n WHERE n.id = NEW.notification_id AND n.user_id = NEW.user_id);
END;
