import { test } from "node:test";
import { setImmediate } from "node:timers";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as storage from "./storage.mjs";
const GB = 1e9;
test("disk guard persists the 30 → 10 hysteresis, including owner, and warnings start above 20", () => {
  const db = new DatabaseSync(":memory:");
  let t = 1000;
  const s = storage.createStorageLedger(db, () => t);
  assert.equal(s.update(202, { bytes: 20 * GB }).warning, false);
  assert.equal(s.update(202, { bytes: 21 * GB }).warning, true);
  assert.equal(s.update(202, { bytes: 30 * GB + 1 }).blocked, true);
  assert.throws(() => s.assertBudget(202), /10 ГБ/);
  assert.equal(s.update(202, { bytes: 15 * GB }).blocked, true);
  assert.equal(storage.createStorageLedger(db, () => t).get(202).blocked, true);
  assert.equal(s.update(202, { bytes: 10 * GB }).blocked, false);
  assert.equal(s.update(1057399602, { bytes: 31 * GB }).blocked, true);
  assert.equal(s.get(303), null);
  assert.throws(() => s.update(202, { bytes: NaN }));
});
test("weekly reminders are durable and failed delivery stays retryable", () => {
  const s = storage.createStorageLedger(new DatabaseSync(":memory:"), () => 1000);
  s.update(202, { bytes: 22 * GB });
  assert.equal(s.needsNotice(202), true);
  s.notified(202);
  assert.equal(s.needsNotice(202), false);
  s.update(202, { bytes: 31 * GB });
  assert.equal(s.needsNotice(202), true);
});
test("watchdog deduplicates scans, stops a blocked worker before notifying and never allows failed checks", async () => {
  const s = storage.createStorageLedger(new DatabaseSync(":memory:"));
  let calls = 0;
  const events = [];
  const guard = storage.createStorageGuard({
    ledger: s,
    scan: async () => {
      calls++;
      return { bytes: 31 * GB };
    },
    stop: async () => events.push("stop"),
    notify: async () => events.push("notice"),
  });
  await Promise.all([guard.refresh(202), guard.refresh(202)]);
  assert.equal(calls, 1);
  assert.deepEqual(events, ["stop", "notice"]);
  await assert.rejects(guard.admit(202), /10 ГБ/);
  const broken = storage.createStorageGuard({
    ledger: s,
    scan: async () => {
      throw Error("scan");
    },
    stop: async () => {},
    notify: async () => {},
  });
  await assert.rejects(broken.admit(303), /проверить/);
  assert.equal(s.get(303), null);
});

test("cleanup holds admission closed, remeasures, and unlocks only at the low water mark", async () => {
  const s = storage.createStorageLedger(new DatabaseSync(":memory:"));
  s.update(202, { bytes: 31 * GB });
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const guard = storage.createStorageGuard({
    ledger: s,
    scan: async () => ({ bytes: 9 * GB }),
    stop: async () => {},
    notify: async () => {},
  });
  const cleanup = guard.clean(202, "cache", async () => gate);
  await assert.rejects(guard.admit(202), /очистки/);
  release();
  await cleanup;
  await guard.admit(202);
  assert.equal(s.get(202).blocked, false);
});
test("weekly high-water reminders repeat after seven days, not on each scan", () => {
  let now = 1000;
  const s = storage.createStorageLedger(new DatabaseSync(":memory:"), () => now);
  s.update(202, { bytes: 21 * GB });
  s.notified(202);
  now += 6 * 86400000;
  assert.equal(s.needsNotice(202), false);
  now += 86400000;
  assert.equal(s.needsNotice(202), true);
  s.update(202, { bytes: 31 * GB });
  s.notified(202);
  s.update(202, { bytes: 9 * GB });
  s.update(202, { bytes: 31 * GB });
  assert.equal(s.needsNotice(202), true);
});

test("storage work runs outside the bot cgroup, serializes users and recovers after failure", async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const run = storage.createStorageRunner(async (command, args, options) => {
    calls.push({ command, args, options });
    if (calls.length === 1) {
      await gate;
      throw Error("scanner OOM");
    }
    return { stdout: '{"bytes":123}' };
  });
  const first = run(202);
  const failure = assert.rejects(first, /scanner OOM/);
  const second = run(303);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, "different users must not scan concurrently");
  release();
  await failure;
  assert.deepEqual(await second, { bytes: 123 });
  for (const call of calls) {
    assert.equal(call.command, "systemd-run");
    assert.ok(call.args.includes("--pipe"));
    assert.ok(call.args.includes("--wait"));
    assert.ok(call.args.includes("--collect"));
    assert.ok(call.args.includes("--property=MemoryMax=768M"));
    assert.ok(call.args.includes("--property=RuntimeMaxSec=180"));
  }
  await assert.rejects(run(0), /user/i);
  await assert.rejects(run(202, "invalid"), /Invalid storage action/);
  assert.equal(calls.length, 2);
});
