import { createClerkClient } from "@clerk/backend";
import { strToU8, zipSync } from "fflate";

const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

function nowISO() {
  return new Date().toISOString();
}

async function run(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).run();
}

async function first(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).first();
}

async function all(env, sql, ...params) {
  const result = await env.DB.prepare(sql).bind(...params).all();
  return result?.results || [];
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function deleteR2Prefix(bucket, prefix) {
  if (!bucket) return;
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    const keys = (page.objects || []).map(object => object.key);
    if (keys.length) await bucket.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const verification = await bucket.list({ prefix, limit: 1 });
  if (verification.objects?.length) throw new Error("r2_cleanup_incomplete");
}

async function deleteProviderFile(env, userId, providerFileId) {
  if (!providerFileId || !env.OPENAI_API_KEY) return;
  const response = await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(providerFileId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }
  });
  if (response.ok || response.status === 404) return;
  const at = nowISO();
  await run(env, `insert into provider_file_cleanup
    (id, user_id, provider, provider_file_id, status, attempt_count, next_attempt_at, last_error, created_at, updated_at)
    values (?, ?, 'openai', ?, 'failed', 1, ?, ?, ?, ?)
    on conflict(provider, provider_file_id) do update set status = 'failed', attempt_count = attempt_count + 1,
      next_attempt_at = excluded.next_attempt_at, last_error = excluded.last_error, updated_at = excluded.updated_at`,
  crypto.randomUUID(), userId, providerFileId, new Date(Date.now() + 3600000).toISOString(),
  `http_${response.status}`, at, at);
  throw new Error("provider_file_cleanup_failed");
}

async function terminateUserBuilds(env, userId) {
  if (!env.RESUME_BUILD_WORKFLOW?.get) return;
  const builds = await all(env, `select id from resume_builds where user_id = ? and status not in
    ('READY','NEEDS_EVIDENCE','NEEDS_REVIEW','JOB_CLOSED','FAILED')`, userId);
  for (const build of builds) {
    try {
      const instance = await env.RESUME_BUILD_WORKFLOW.get(build.id);
      await instance.terminate();
    } catch {
      // A missing or already-complete instance is safe; D1 fencing below prevents further writes.
    }
  }
  await run(env, `update resume_builds set status = 'FAILED', failure_code = 'account_deletion',
    completed_at = ?, updated_at = ?, lease_expires_at = null where user_id = ? and status not in
    ('READY','NEEDS_EVIDENCE','NEEDS_REVIEW','JOB_CLOSED','FAILED')`, nowISO(), nowISO(), userId);
}

async function revokeClerkSessions(env, userId) {
  if (!env.CLERK_SECRET_KEY) return;
  const list = await fetch(`https://api.clerk.com/v1/sessions?user_id=${encodeURIComponent(userId)}&limit=100`, {
    headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
    signal: AbortSignal.timeout(30000)
  });
  if (!list.ok && list.status !== 404) throw new Error(`clerk_session_list_${list.status}`);
  const sessions = list.ok ? await list.json() : [];
  for (const session of Array.isArray(sessions) ? sessions : sessions?.data || []) {
    if (!session?.id || ["revoked", "ended", "expired", "removed", "abandoned"].includes(session.status)) continue;
    const revoked = await fetch(`https://api.clerk.com/v1/sessions/${encodeURIComponent(session.id)}/revoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
      signal: AbortSignal.timeout(30000)
    });
    if (!revoked.ok && revoked.status !== 404) throw new Error(`clerk_session_revoke_${revoked.status}`);
  }
}

async function deleteUserRows(env, userId) {
  const statements = [
    "delete from notification_deliveries where user_id = ?",
    "delete from notifications where user_id = ?",
    "delete from generated_artifacts where user_id = ?",
    "delete from resume_build_drafts where user_id = ?",
    "delete from provider_cost_events where user_id = ?",
    "delete from usage_events where user_id = ?",
    "delete from resume_build_versions where user_id = ?",
    "delete from resume_builds where user_id = ?",
    "delete from build_rules where user_id = ?",
    "delete from resume_profile_evidence where user_id = ?",
    "delete from resume_profiles where user_id = ?",
    "delete from candidate_evidence where user_id = ?",
    "delete from resume_sources where user_id = ?",
    "delete from custom_job_inputs where user_id = ?",
    "delete from usage_reservations where user_id = ?",
    "delete from entitlement_grants where user_id = ?",
    "delete from billing_webhook_events where user_id = ?",
    "delete from billing_accounts where user_id = ?",
    "delete from api_idempotency_keys where user_id = ?",
    "delete from provider_file_cleanup where user_id = ?",
    "delete from saved_searches where user_id = ?",
    "delete from privacy_consents where user_id = ? or session_id in (select id from anonymous_sessions where user_id = ?)",
    "delete from job_views where user_id = ? or session_id in (select id from anonymous_sessions where user_id = ?)",
    "delete from search_queries where user_id = ? or session_id in (select id from anonymous_sessions where user_id = ?)",
    "delete from page_views where user_id = ? or session_id in (select id from anonymous_sessions where user_id = ?)",
    "delete from anonymous_sessions where user_id = ?",
    "delete from agency_feedback where user_id = ?",
    "delete from user_job_history where user_id = ?",
    "delete from user_jobs where user_id = ?",
    "delete from user_activity where user_id = ?",
    "delete from user_profiles where user_id = ?",
    "delete from agency_profiles where user_id = ?",
    "delete from account_access where user_id = ?",
    "delete from data_export_requests where user_id = ?"
  ];
  for (const sql of statements) {
    const placeholders = (sql.match(/\?/g) || []).length;
    await run(env, sql, ...Array(placeholders).fill(userId));
  }
}

export async function processAccountDeletion(env, deletionId) {
  const request = await first(env, "select * from account_deletion_requests where id = ?", deletionId);
  if (!request || request.status === "complete") return { complete: true };
  const userId = request.user_id;
  const updateStep = async step => run(env, `update account_deletion_requests set status = 'processing', current_step = ?,
    attempt_count = attempt_count + 1, updated_at = ? where id = ?`, step, nowISO(), deletionId);
  try {
    await updateStep("fence_work");
    await run(env, "update users set lifecycle_state = 'deletion_pending', deletion_requested_at = coalesce(deletion_requested_at, ?), updated_at = ? where id = ?",
      nowISO(), nowISO(), userId);
    await terminateUserBuilds(env, userId);
    if (request.source !== "clerk_webhook") await revokeClerkSessions(env, userId);

    await updateStep("delete_provider_files");
    const providerFiles = await all(env, "select provider_file_id from resume_sources where user_id = ? and provider_file_id is not null", userId);
    for (const file of providerFiles) await deleteProviderFile(env, userId, file.provider_file_id);

    await updateStep("delete_private_objects");
    await deleteR2Prefix(env.RESUME_FILES, `users/${userId}/`);
    await deleteR2Prefix(env.RESUME_FILES, `exports/${userId}/`);

    await updateStep("delete_application_data");
    await deleteUserRows(env, userId);

    await updateStep("delete_identity");
    if (env.CLERK_SECRET_KEY && request.source !== "clerk_webhook") {
      const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
      await clerk.users.deleteUser(userId);
    }

    await run(env, "delete from users where id = ?", userId);
    await run(env, `update account_deletion_requests set status = 'complete', current_step = 'complete',
      failure_code = null, updated_at = ?, completed_at = ? where id = ?`, nowISO(), nowISO(), deletionId);
    return { complete: true };
  } catch (failure) {
    await run(env, `update account_deletion_requests set status = 'retrying', failure_code = ?,
      updated_at = ? where id = ?`, String(failure?.message || "deletion_failed").slice(0, 120), nowISO(), deletionId);
    throw failure;
  }
}

const EXPORT_TABLES = [
  "users", "user_profiles", "agency_profiles", "account_access", "user_jobs", "user_job_history",
  "user_activity", "saved_searches", "alert_preferences", "privacy_consents", "resume_sources", "candidate_evidence",
  "resume_profiles", "resume_profile_evidence", "custom_job_inputs", "resume_builds", "resume_build_versions",
  "resume_build_drafts", "generated_artifacts", "build_rules", "notifications", "notification_deliveries",
  "entitlement_grants", "usage_reservations", "usage_events", "provider_cost_events"
];

export async function processDataExport(env, exportId) {
  const request = await first(env, "select * from data_export_requests where id = ?", exportId);
  if (!request || request.status === "ready") return { complete: true };
  const userId = request.user_id;
  await run(env, "update data_export_requests set status = 'processing', updated_at = ? where id = ?", nowISO(), exportId);
  try {
    const data = {};
    for (const table of EXPORT_TABLES) {
      const column = table === "users" ? "id" : "user_id";
      data[table] = await all(env, `select * from ${table} where ${column} = ?`, userId);
    }
    const files = {
      "account-data.json": strToU8(JSON.stringify({ exported_at: nowISO(), data }, null, 2))
    };
    let totalBytes = files["account-data.json"].byteLength;
    if (env.RESUME_FILES) {
      let cursor;
      do {
        const page = await env.RESUME_FILES.list({ prefix: `users/${userId}/`, cursor, limit: 100 });
        for (const item of page.objects || []) {
          if (totalBytes + Number(item.size || 0) > MAX_EXPORT_BYTES) throw new Error("export_too_large");
          const object = await env.RESUME_FILES.get(item.key);
          if (!object) continue;
          const bytes = new Uint8Array(await object.arrayBuffer());
          files[`files/${item.key.replace(`users/${userId}/`, "")}`] = bytes;
          totalBytes += bytes.byteLength;
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    const archive = zipSync(files, { level: 6 });
    const key = `exports/${userId}/${exportId}.zip`;
    await env.RESUME_FILES.put(key, archive, {
      httpMetadata: { contentType: "application/zip" },
      customMetadata: { userId, exportId }
    });
    const digest = await sha256Hex(archive.buffer);
    const completed = nowISO();
    await run(env, `update data_export_requests set status = 'ready', r2_key = ?, sha256 = ?, byte_size = ?,
      expires_at = ?, updated_at = ?, completed_at = ? where id = ?`, key, digest, archive.byteLength,
    new Date(Date.now() + 86400000).toISOString(), completed, completed, exportId);
    return { complete: true, byte_size: archive.byteLength };
  } catch (failure) {
    await run(env, "update data_export_requests set status = 'failed', failure_code = ?, updated_at = ? where id = ?",
      String(failure?.message || "export_failed").slice(0, 120), nowISO(), exportId);
    throw failure;
  }
}
