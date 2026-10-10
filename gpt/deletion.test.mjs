import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "gpt-delete-test-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  BOT_TOKEN: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  ALLOWED_USER_IDS: "1057399602",
});
await import("../dist/db.js");
const store = await import("./store.mjs");
test("deletion validates the whole batch and cannot select another owner", () => {
  const a = store.createThread(101, "same", "One"),
    b = store.createThread(202, "same", "Two");
  assert.throws(() => store.beginDeletion(101, [a.id, b.id]));
  assert.equal(store.pendingDeletions(101).length, 0);
  assert.ok(store.getThread(101, a.id));
});
test("deletion removes messages/jobs/selection, keeps other dialogs and releases one slot", () => {
  const ids = Array.from({ length: 5 }, (_, i) => store.createThread(303, "same", String(i)).id);
  const id = ids[4];
  store.addMessage(303, id, "user", "DELETE_PRIVATE_CONTENT");
  store.startJob(303, id);
  store.beginDeletion(303, [id]);
  assert.throws(() => store.selectThread(303, id), /удал/);
  store.finishDeletion(303, id);
  assert.equal(store.getThread(303, id), undefined);
  assert.deepEqual(store.messages(303, id), []);
  assert.equal(store.threadCount(303), 4);
  assert.ok(store.peekActiveThread(303));
  assert.ok(store.createThread(303));
  assert.equal(store.pendingDeletions(303).length, 0);
});
test("an interrupted deletion remains retryable without counting as finished", () => {
  const row = store.createThread(404);
  store.beginDeletion(404, [row.id]);
  store.failDeletion(404, row.id, "filesystem unavailable");
  assert.equal(store.pendingDeletions(404).length, 1);
  assert.equal(store.threadCount(404), 1);
  store.beginDeletion(404, [row.id]);
  store.finishDeletion(404, row.id);
  assert.equal(store.threadCount(404), 0);
});
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
