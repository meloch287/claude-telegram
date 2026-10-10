import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeLimits, createSubscriptionMonitor } from "./subscription.mjs";
test("official windows are preserved, missing is unknown, private account fields never escape", () => {
  const s = sanitizeLimits({
    accountId: "private",
    rateLimits: {
      limitId: "codex",
      planType: "pro",
      primary: { usedPercent: 3, windowDurationMins: 10080, resetsAt: 1791580519 },
    },
    rateLimitsByLimitId: { reserve: { primary: { usedPercent: 0 } } },
  });
  assert.equal(s.buckets.find((b) => b.id === "codex").primary.remainingPercent, 97);
  assert.equal(s.buckets.find((b) => b.id === "codex").primary.resetsAt, 1791580519000);
  assert.equal(s.buckets[0].primary.resetsAt, null);
  assert.ok(!JSON.stringify(s).includes("private"));
  assert.deepEqual(sanitizeLimits({}).buckets, []);
});
test("monitor coalesces requests, caches reads and labels failed stale data without inventing zero", async () => {
  let t = 1000,
    calls = 0,
    fail = false;
  const m = createSubscriptionMonitor(
    async () => {
      calls++;
      if (fail) throw Error();
      return { buckets: [{ id: "codex" }] };
    },
    () => t,
  );
  await Promise.all([m.get(), m.get()]);
  assert.equal(calls, 1);
  t += 100;
  assert.equal((await m.get()).stale, false);
  assert.equal(calls, 1);
  t += 60000;
  fail = true;
  const s = await m.get();
  assert.equal(s.stale, true);
  assert.equal(s.buckets[0].id, "codex");
  const empty = createSubscriptionMonitor(
    async () => {
      throw Error();
    },
    () => t,
  );
  assert.equal((await empty.get()).fetchedAt, null);
});

test("a synchronous reader failure also permits retry", async () => {
  let now = 1000,
    calls = 0;
  const m = createSubscriptionMonitor(
    () => {
      calls++;
      throw Error();
    },
    () => now,
  );
  await m.get();
  now += 60000;
  await m.get();
  assert.equal(calls, 2);
});

test("enforcement forces a fresh read even inside UI cache TTL", async () => {
  let calls = 0;
  const m = createSubscriptionMonitor(async () => ({ buckets: [], sequence: ++calls }));
  await m.get();
  await m.get({ force: true });
  assert.equal(calls, 2);
});

test("forced check waits for an older in-flight UI read then reads again", async () => {
  let calls = 0,
    release;
  const m = createSubscriptionMonitor(async () => {
    calls++;
    if (calls === 1)
      await new Promise((r) => {
        release = r;
      });
    return { buckets: [], sequence: calls };
  });
  const ui = m.get();
  await Promise.resolve();
  const check = m.get({ force: true });
  release();
  await ui;
  assert.equal((await check).sequence, 2);
});
