PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS resume_builds_tenant_insert
BEFORE INSERT ON resume_builds
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resume_profiles p WHERE p.id = NEW.profile_id AND p.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'resume_build_profile_tenant_mismatch') END;
  SELECT CASE WHEN NEW.custom_job_input_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM custom_job_inputs c WHERE c.id = NEW.custom_job_input_id AND c.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'resume_build_custom_job_tenant_mismatch') END;
  SELECT CASE WHEN NEW.credit_reservation_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM usage_reservations r WHERE r.id = NEW.credit_reservation_id AND r.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'resume_build_reservation_tenant_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS resume_builds_tenant_update
BEFORE UPDATE OF user_id, profile_id, custom_job_input_id, credit_reservation_id ON resume_builds
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resume_profiles p WHERE p.id = NEW.profile_id AND p.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'resume_build_profile_tenant_mismatch') END;
  SELECT CASE WHEN NEW.custom_job_input_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM custom_job_inputs c WHERE c.id = NEW.custom_job_input_id AND c.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'resume_build_custom_job_tenant_mismatch') END;
  SELECT CASE WHEN NEW.credit_reservation_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM usage_reservations r WHERE r.id = NEW.credit_reservation_id AND r.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'resume_build_reservation_tenant_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS resume_versions_tenant_insert
BEFORE INSERT ON resume_build_versions
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resume_builds b WHERE b.id = NEW.build_id AND b.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'resume_version_build_tenant_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS resume_versions_tenant_update
BEFORE UPDATE OF user_id, build_id ON resume_build_versions
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resume_builds b WHERE b.id = NEW.build_id AND b.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'resume_version_build_tenant_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS resume_drafts_tenant_insert
BEFORE INSERT ON resume_build_drafts
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resume_builds b WHERE b.id = NEW.build_id AND b.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'resume_draft_build_tenant_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS artifacts_tenant_insert
BEFORE INSERT ON generated_artifacts
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resume_builds b WHERE b.id = NEW.build_id AND b.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'artifact_build_tenant_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resume_build_versions v WHERE v.id = NEW.version_id AND v.build_id = NEW.build_id AND v.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'artifact_version_tenant_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS profile_evidence_tenant_insert
BEFORE INSERT ON resume_profile_evidence
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resume_profiles p WHERE p.id = NEW.profile_id AND p.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'profile_evidence_profile_tenant_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM candidate_evidence e WHERE e.id = NEW.evidence_id AND e.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'profile_evidence_item_tenant_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS usage_events_tenant_insert
BEFORE INSERT ON usage_events
BEGIN
  SELECT CASE WHEN NEW.build_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM resume_builds b WHERE b.id = NEW.build_id AND b.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'usage_event_build_tenant_mismatch') END;
  SELECT CASE WHEN NEW.reservation_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM usage_reservations r WHERE r.id = NEW.reservation_id AND r.user_id = NEW.user_id)
    THEN RAISE(ABORT, 'usage_event_reservation_tenant_mismatch') END;
END;
