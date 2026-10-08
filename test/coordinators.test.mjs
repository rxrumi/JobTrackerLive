import assert from "node:assert/strict";
import test from "node:test";
import { RateLimitCoordinator, UserMutationCoordinator, ScanCoordinator } from "../src/worker.js";

function createStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  let alarm = null;
  return {
    entries,
    async get(key) { return structuredClone(entries.get(key)); },
    async put(key, value, options) {
      assert.equal(options?.expirationTtl, undefined, "DO storage does not support TTL options");
      entries.set(key, structuredClone(value));
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) entries.delete(key);
    },
    async list({ prefix, limit, startAfter }) {
      return new Map([...entries].sort(([a], [b]) => a.localeCompare(b))
        .filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter)).slice(0, limit));
    },
    async getAlarm() { return alarm; },
    async setAlarm(time) { alarm = time; },
    fireAlarm() { alarm = null; }
  };
}

function request(path, body) {
  return new Request(`https://coordinator.internal${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
}

test("rate limit alarms remove expired buckets and preserve current limits", async () => {
  const storage = createStorage({ "limit:expired": { count: 1, resetAt: Date.now() - 1000 } });
  const coordinator = new RateLimitCoordinator({ storage });
  assert.equal((await coordinator.fetch(request("/check", { key: "live", limit: 1, window_seconds: 60 }))).status, 200);
  assert.ok(await storage.getAlarm());
  storage.fireAlarm();
  await coordinator.alarm();
  assert.equal(storage.entries.has("limit:expired"), false);
  assert.equal(storage.entries.has("limit:live"), true);
  assert.equal((await coordinator.fetch(request("/check", { key: "live", limit: 1, window_seconds: 60 }))).status, 429);
  assert.equal(await storage.getAlarm(), storage.entries.get("limit:live").resetAt);
});

test("claim alarms clean expired locks without releasing a live operation", async () => {
  const storage = createStorage({ "claim:expired": { token: "old", expiresAt: Date.now() - 1000 } });
  const coordinator = new UserMutationCoordinator({ storage });
  const claim = await coordinator.fetch(request("/claim", { key: "build", ttl_ms: 30000 }));
  assert.equal(claim.status, 201);
  const payload = await claim.json();
  storage.fireAlarm();
  await coordinator.alarm();
  assert.equal(storage.entries.has("claim:expired"), false);
  assert.equal((await coordinator.fetch(request("/claim", { key: "build" }))).status, 409);
  await coordinator.fetch(request("/release", { key: "build", token: "wrong" }));
  assert.equal(storage.entries.has("claim:build"), true);
  await coordinator.fetch(request("/release", { key: "build", token: payload.token }));
  assert.equal(storage.entries.has("claim:build"), false);
});

test("expiry sweeps page through storage without unbounded alarm work", async () => {
  const expiry = Date.now() + 60000;
  const initial = Object.fromEntries(Array.from({ length: 300 }, (_, i) =>
    [`limit:${String(i).padStart(3, "0")}`, { count: 1, resetAt: i === 0 ? expiry : Date.now() - 1 }]));
  const storage = createStorage(initial);
  const coordinator = new RateLimitCoordinator({ storage });
  for (let page = 0; page < 3; page++) {
    storage.fireAlarm();
    await coordinator.alarm();
  }
  assert.deepEqual([...storage.entries.keys()], ["limit:000"]);
  assert.equal(await storage.getAlarm(), expiry);
});

test("expiry paging reschedules keys inserted before its cursor", async () => {
  const storage = createStorage(Object.fromEntries(Array.from({ length: 128 }, (_, i) =>
    [`claim:z${String(i).padStart(3, "0")}`, { expiresAt: Date.now() - 1000 }])));
  const coordinator = new UserMutationCoordinator({ storage });
  await coordinator.alarm();
  storage.entries.set("claim:new", { expiresAt: Date.now() - 1000 });
  storage.fireAlarm();
  await coordinator.alarm();
  assert.ok(await storage.getAlarm());
  storage.fireAlarm();
  await coordinator.alarm();
  assert.equal(storage.entries.size, 0);
});
