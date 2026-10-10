import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as percent from "./percent-quota.mjs";
const owner = 1057399602;
function fixture() {
  const db = new DatabaseSync(":memory:");
  let now = 1791000000000;
  const reset = now + 86400000;
  const ledger = percent.createPercentLedger(db, owner, () => now);
  let value = 3,
    end = reset,
    stale = false,
    reads = 0;
  const monitor = {
    get: async ({ force } = {}) => {
      assert.equal(force, true);
      reads++;
      return {
        stale,
        buckets: [
          {
            id: "codex",
            primary: { usedPercent: value, resetsAt: end, windowDurationMins: 10080 },
          },
        ],
      };
    },
  };
  const controller = percent.createPercentController(
    ledger,
    monitor,
    () => {},
    () => now,
  );
  return {
    db,
    ledger,
    controller,
    reset,
    get reads() {
      return reads;
    },
    value: (v) => (value = v),
    stale: (v) => (stale = v),
    time: (v) => (now = v),
    resetAt: (v) => (end = v),
  };
}
test("default is ten account percentage points; owner exempt; repeated samples charge once", async () => {
  const f = fixture();
  assert.equal(f.ledger.quota(202).limit, 10);
  assert.equal(f.ledger.quota(owner).limit, null);
  await f.controller.begin(202, "a");
  f.value(8);
  await Promise.all([f.controller.before(202, "a"), f.controller.before(202, "a")]);
  assert.equal(f.ledger.quota(202).used, 5);
  f.value(14);
  await assert.rejects(f.controller.before(202, "a"), /недельный/);
  assert.equal(f.ledger.quota(202).used, 11);
  await f.controller.finish("a");
  await assert.rejects(f.controller.begin(202, "b"), /недельный/);
  await f.controller.begin(owner, "owner");
  f.value(50);
  await f.controller.before(owner, "owner");
  await f.controller.finish("owner");
  assert.equal(f.ledger.quota(202).used, 11);
});
test("idle account changes are excluded, users isolated, reset rolls with OpenAI", async () => {
  const f = fixture();
  await f.controller.begin(202, "a");
  f.value(7);
  await f.controller.finish("a");
  f.value(30);
  await f.controller.begin(303, "b");
  f.value(32);
  await f.controller.finish("b");
  assert.equal(f.ledger.quota(202).used, 4);
  assert.equal(f.ledger.quota(303).used, 2);
  f.time(f.reset + 1);
  f.resetAt(f.reset + 7 * 86400000);
  f.value(0);
  await f.controller.begin(202, "c");
  assert.equal(f.ledger.quota(202).used, 0);
  f.value(1);
  await f.controller.finish("c");
  assert.equal(f.ledger.quota(202).used, 1);
});
test("missing or decreasing observations fail closed; interruption recovery charges previous user", async () => {
  const f = fixture();
  f.stale(true);
  await assert.rejects(f.controller.begin(202, "a"), /OpenAI/);
  f.stale(false);
  await f.controller.begin(202, "a");
  f.value(2);
  await assert.rejects(f.controller.before(202, "a"), /OpenAI/);
  f.value(8);
  f.stale(true);
  await assert.rejects(f.controller.finish("a"), /OpenAI/);
  assert.equal(f.ledger.active().job_id, "a");
  f.stale(false);
  const restarted = percent.createPercentController(
    percent.createPercentLedger(f.db, owner),
    {
      get: async () => ({
        stale: false,
        buckets: [
          {
            id: "codex",
            primary: { usedPercent: 8, resetsAt: f.reset, windowDurationMins: 10080 },
          },
        ],
      }),
    },
    () => {},
    () => 1791000000000,
  );
  await restarted.begin(303, "b");
  assert.equal(f.ledger.quota(202).used, 5);
  assert.equal(f.ledger.quota(303).used, 0);
  await assert.rejects(restarted.before(202, "a"), /задач/);
});

test("task spanning reset charges new window only and expired snapshots cannot reopen old week", async () => {
  const f = fixture();
  await f.controller.begin(202, "boundary");
  f.value(12);
  await f.controller.before(202, "boundary");
  f.time(f.reset + 1);
  await assert.rejects(f.controller.before(202, "boundary"), /OpenAI/);
  f.resetAt(f.reset + 7 * 86400000);
  f.value(2);
  await f.controller.before(202, "boundary");
  assert.equal(f.ledger.quota(202).used, 2);
  assert.equal(f.ledger.quota(202).exceeded, false);
});
