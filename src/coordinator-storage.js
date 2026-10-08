// Durable Object storage has no per-key TTL. Sweep a bounded page per alarm.
const EXPIRY_CURSOR_KEY = "expiry_cursor";
const EXPIRY_PAGE_SIZE = 128;

export async function scheduleExpiry(storage, expiresAt) {
  const alarm = await storage.getAlarm();
  if (alarm == null || alarm > expiresAt) await storage.setAlarm(expiresAt);
}

export async function expireCoordinatorEntries(storage, prefix, expiryField) {
  const now = Date.now();
  const cursor = await storage.get(EXPIRY_CURSOR_KEY);
  const entries = await storage.list({
    prefix,
    limit: EXPIRY_PAGE_SIZE,
    ...(cursor?.after ? { startAfter: cursor.after } : {})
  });
  const expired = [];
  let nextExpiry = cursor?.nextExpiry ?? null;
  for (const [key, value] of entries) {
    const expiresAt = Number(value?.[expiryField]);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) expired.push(key);
    else nextExpiry = nextExpiry == null ? expiresAt : Math.min(nextExpiry, expiresAt);
  }
  if (expired.length) await storage.delete(expired);
  if (entries.size === EXPIRY_PAGE_SIZE) {
    await storage.put(EXPIRY_CURSOR_KEY, { after: [...entries.keys()].at(-1), nextExpiry });
    await scheduleExpiry(storage, now + 1000);
  } else {
    await storage.delete(EXPIRY_CURSOR_KEY);
    if (nextExpiry != null) await scheduleExpiry(storage, Math.max(now + 1000, nextExpiry));
    else if (cursor && (await storage.list({ prefix, limit: 1 })).size) {
      // A request may have inserted a key before the paging cursor. Verify
      // that prefix again rather than leaving new entries without an alarm.
      await scheduleExpiry(storage, now + 1000);
    }
  }
}
