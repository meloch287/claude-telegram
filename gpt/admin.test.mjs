import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "gpt-admin-test-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  BOT_TOKEN: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  ALLOWED_USER_IDS: "1057399602,202",
});
const legacy = await import("../dist/db.js");
const store = await import("./store.mjs");
const owner = 1057399602;
test("default is five dialogs; owner can raise individual limits and remains unlimited", () => {
  assert.equal(store.userPolicy(606).dialog_limit, 5);
  for (let i = 0; i < 5; i++) store.createThread(606);
  assert.throws(() => store.createThread(606), /\/delete/);
  store.setUserPolicy(owner, 606, { dialogLimit: null });
  assert.throws(() => store.createThread(606), /\/delete/);
  store.setUserPolicy(owner, 606, { dialogLimit: 10 });
  assert.equal(store.userPolicy(606).dialog_limit, 10);
  for (let i = 0; i < 5; i++) store.createThread(606);
  assert.throws(() => store.createThread(606), /\/delete/);
  store.setUserPolicy(owner, 606, { note: "keeps custom limit" });
  assert.equal(store.userPolicy(606).dialog_limit, 10);
  store.setUserPolicy(owner, 606, { dialogLimit: 1000000 });
  assert.equal(store.userPolicy(606).dialog_limit, 1000000);
  for (const dialogLimit of [-1, 1.5, "10", NaN, Infinity])
    assert.throws(() => store.setUserPolicy(owner, 606, { dialogLimit }));
  store.setUserPolicy(owner, owner, { dialogLimit: 1 });
  for (let i = 0; i < 8; i++) store.createThread(owner);
  assert.equal(store.userPolicy(owner).dialog_limit, null);
});
test("only the fixed owner manages access, including users from env", () => {
  assert.throws(() => store.setUserPolicy(202, 303, { allowed: true }));
  assert.throws(() => store.setUserPolicy(owner, owner, { allowed: false }));
  store.setUserPolicy(owner, 202, { allowed: false });
  assert.equal(legacy.isGptUserAllowed(202), false);
  store.setUserPolicy(owner, 303, { allowed: true });
  assert.equal(legacy.isGptUserAllowed(303), true);
});
test("dialog limits apply to every creation path without deleting old dialogs", () => {
  store.setUserPolicy(owner, 404, { allowed: true, dialogLimit: 1 });
  const row = store.createThread(404, "one");
  assert.throws(() => store.createThread(404, "two"), /лимит диалогов/);
  assert.equal(store.activeThread(404).id, row.id);
  store.setUserPolicy(owner, 404, { dialogLimit: 0 });
  assert.equal(store.getThread(404, row.id).id, row.id);
  assert.throws(() => store.createThread(404), /лимит диалогов/);
});
test("daily token budgets include cached input, survive updates, and reset in UTC", () => {
  store.setUserPolicy(owner, 505, { allowed: true, tokenLimit: 10, quotaMode: "tokens" });
  store.assertTokenBudget(505);
  store.recordTokens(505, { input_tokens: 7, cached_input_tokens: 7, output_tokens: 3 });
  assert.throws(() => store.assertTokenBudget(505), /лимит токенов/);
  store.setUserPolicy(owner, 505, { dialogLimit: 4 });
  assert.equal(store.userPolicy(505).token_limit, 10);
  assert.equal(store.tokensToday(505, "2099-01-01"), 0);
  store.setUserPolicy(owner, 505, { tokenLimit: null });
  store.assertTokenBudget(505);
  for (const tokenLimit of [-1, 1.5, "10", NaN])
    assert.throws(() => store.setUserPolicy(owner, 505, { tokenLimit }));
});
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
