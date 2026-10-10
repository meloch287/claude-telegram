import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "gpt-store-test-"));
process.env.DATA_DIR = dir;
process.env.BOT_TOKEN = "test-only";
process.env.ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");
process.env.ALLOWED_USER_IDS = "101";
const store = await import("./store.mjs");
test("a guessed thread ID cannot expose or change another user conversation", () => {
  const a = store.createThread(101, "alpha", "Alice private");
  const b = store.createThread(202, "beta", "Bob private");
  store.addMessage(101, a.id, "user", "private-A");
  store.addMessage(202, b.id, "user", "private-B");
  assert.equal(store.getThread(101, b.id), undefined);
  assert.deepEqual(store.messages(101, b.id), []);
  assert.throws(() => store.selectThread(101, b.id));
  assert.throws(() => store.addMessage(101, b.id, "assistant", "injected"));
  store.renameThread(101, b.id, "injected");
  assert.equal(store.getThread(202, b.id).title, "Bob private");
  assert.ok(store.listThreads(101).every((t) => t.project === "alpha"));
});
test("all migrated threads can be paginated without crossing owners", () => {
  for (let i = 0; i < 23; i++) store.createThread(1057399602, "history", `Chat ${i}`);
  const ids = new Set();
  for (const offset of [0, 10, 20])
    for (const t of store.listThreads(1057399602, offset).slice(0, 10)) ids.add(t.id);
  assert.equal(ids.size, 23);
  assert.throws(() => store.listThreads(1057399602, -1));
  assert.throws(() => store.listThreads(1057399602, "0"));
});
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
