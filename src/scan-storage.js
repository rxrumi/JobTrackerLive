// Retain recent scan history and each job's latest details. Cleanup is bounded
// because deleting indexed D1 rows also consumes the daily write allowance.
export const SCAN_RETENTION_DAYS = 20;
export const SNAPSHOT_CLEANUP_BATCH = 250;
export const EXPIRED_SNAPSHOTS_SQL = `delete from job_snapshots where id in (
  select old.id from job_snapshots old
  where old.scan_date < ?
    and exists (select 1 from job_snapshots newer
      where newer.job_id = old.job_id and newer.scan_date > old.scan_date)
  order by old.scan_date, old.id limit ?
)`;

const EXPIRED_FEEDS_WHERE = `status = 'retired' and created_at < ?
  and not exists (select 1 from feed_pointer
    where current_version = feed_publications.version
      or previous_version = feed_publications.version)`;

export async function runScanStorageMaintenance(env, deps, at = new Date()) {
  const cutoff = new Date(at.getTime() - SCAN_RETENTION_DAYS * 86400000).toISOString();
  const snapshots = await deps.run(env, EXPIRED_SNAPSHOTS_SQL, cutoff.slice(0, 10), SNAPSHOT_CLEANUP_BATCH);
  let feedsDeleted = 0;
  if (env.JOB_FEEDS?.delete) {
    const feeds = await deps.all(env, `select version, r2_key from feed_publications
      where ${EXPIRED_FEEDS_WHERE} order by created_at limit 25`, cutoff);
    for (const feed of feeds) {
      // Keep metadata until the object deletion succeeds, so failures retry.
      await env.JOB_FEEDS.delete(feed.r2_key);
      await deps.run(env, `delete from feed_publications
        where version = ? and ${EXPIRED_FEEDS_WHERE}`, feed.version, cutoff);
      feedsDeleted++;
    }
  }
  return { snapshots_deleted: Number(snapshots?.meta?.changes || 0), feeds_deleted: feedsDeleted };
}
