import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "gpt-quota-test-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  BOT_TOKEN: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  ALLOWED_USER_IDS: "1057399602",
});
const legacy = await import("../dist/db.js");
const s = await import("./store.mjs"),
  owner = 1057399602;
test("ledger deduplicates, accounts cache once and applies personal daily/weekly limits", () => {
  s.setUserPolicy(owner, 202, { allowed: true, tokenLimit: 10, weeklyLimit: 20 });
  assert.equal(
    s.recordMeteredUsage(
      202,
      { input_tokens: 100, cached_input_tokens: 100 },
      "gpt-6-sol",
      "response:1",
    ),
    true,
  );
  assert.equal(
    s.recordMeteredUsage(
      202,
      { input_tokens: 100, cached_input_tokens: 100 },
      "gpt-6-sol",
      "response:1",
    ),
    false,
  );
  assert.equal(s.tokensToday(202), 100);
  assert.equal(legacy.getOrCreateUser(202).total_tokens, 100);
  assert.equal(legacy.getUsageToday(202).tokens, 100);
  assert.equal(s.quotaUsage(202).daily.used, 10);
  assert.throws(() => s.assertTokenBudget(202), /суточный/);
  s.setUserPolicy(owner, 202, { tokenLimit: 100, weeklyLimit: 10 });
  assert.throws(() => s.assertTokenBudget(202), /недельный/);
  assert.equal(s.quotaUsage(303).daily.used, 0);
  s.setUserPolicy(owner, 202, { quotaMode: "tokens", weeklyLimit: null });
  assert.throws(() => s.assertTokenBudget(202), /токенов/);
  s.setUserPolicy(owner, 202, { tokenLimit: null });
  s.assertTokenBudget(202);
  for (const patch of [{ weeklyLimit: -1 }, { weeklyLimit: 1.5 }, { quotaMode: "fake" }])
    assert.throws(() => s.setUserPolicy(owner, 202, patch));
});
test("day and week boundaries, zero limits, historical raw counts and purge", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  s.recordMeteredUsage(303, { input_tokens: 100 }, "gpt-6-sol", "old", now - 1);
  s.recordMeteredUsage(303, { input_tokens: 20 }, "gpt-6-sol", "new", now);
  assert.equal(s.quotaUsage(303, now).weekly.used, 20);
  s.setUserPolicy(owner, 404, { tokenLimit: 0 });
  assert.throws(() => s.assertTokenBudget(404));
  s.recordTokens(505, { input_tokens: 123 });
  assert.equal(s.quotaUsage(505).daily.used, 0);
  assert.equal(s.tokensToday(505), 123);
  s.purgeUserLive(303);
  assert.equal(s.meteredUsage(303).tokens, 0);
  assert.equal(s.meteredUsage(202).tokens, 100);
});
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

test("weekly reset sync accepts only fresh official weekly windows; owner is exempt", () => {
  const reset = Date.now() + 2 * 86400000;
  s.syncQuotaReset({
    stale: false,
    buckets: [{ id: "codex", primary: { windowDurationMins: 10080, resetsAt: reset } }],
  });
  assert.equal(s.quotaUsage(202).weekly.resetsAt, reset);
  s.syncQuotaReset({
    stale: true,
    buckets: [{ id: "codex", primary: { windowDurationMins: 10080, resetsAt: reset + 5000 } }],
  });
  assert.equal(s.quotaUsage(202).weekly.resetsAt, reset);
  s.setUserPolicy(owner, owner, { weeklyLimit: 0 });
  assert.equal(s.quotaUsage(owner).weekly.limit, null);
});

test("everyone has a separate ten percent weekly budget; owner has no personal limits", () => {
  assert.equal(s.quotaUsage(987).subscription.limit, 10);
  assert.equal(s.quotaUsage(owner).subscription.limit, null);
  s.setUserPolicy(owner, owner, { tokenLimit: 0 });
  s.assertTokenBudget(owner);
});

test("admin sets weekly percent, including fractional caps; no reset of already used quota", () => {
  s.setUserPolicy(owner, 909, { allowed: true, percentLimit: 7.5 });
  assert.equal(s.quotaUsage(909).subscription.limit, 7.5);
  for (const value of [-1, 101, NaN, null])
    assert.throws(() => s.setUserPolicy(owner, 909, { percentLimit: value }));
  s.setUserPolicy(owner, 909, { percentLimit: 0 });
  assert.throws(() => s.assertTokenBudget(909), /недельный/);
  s.setUserPolicy(owner, owner, { percentLimit: 0 });
  assert.equal(s.quotaUsage(owner).subscription.limit, null);
});
