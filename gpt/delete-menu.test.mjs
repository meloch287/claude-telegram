import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "gpt-menu-test-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  BOT_TOKEN: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  ALLOWED_USER_IDS: "1057399602",
});
await import("../dist/db.js");
const store = await import("./store.mjs");
const { registerDeleteMenu } = await import("./delete-menu.mjs");
test("multi-page selection requires confirmation and rejects stale or foreign buttons", async () => {
  const uid = 1057399602,
    rows = Array.from({ length: 12 }, (_, i) => store.createThread(uid, "default", `Chat ${i}`));
  const foreign = store.createThread(202, "default", "Foreign");
  let command, callback, pattern, kb, answer, deleted;
  registerDeleteMenu(
    {
      command: (_name, handler) => {
        command = handler;
      },
      callbackQuery: (regex, handler) => {
        pattern = regex;
        callback = handler;
      },
    },
    {
      retryDeletions: async () => ({ failed: [] }),
      deleteDialogs: async (owner, ids) => {
        deleted = { owner, ids };
        return { deleted: ids, failed: [] };
      },
    },
  );
  const ctx = {
    from: { id: uid },
    reply: async (_text, options) => {
      kb = options.reply_markup;
    },
    answerCallbackQuery: async (text) => {
      answer = text;
    },
    editMessageReplyMarkup: async (options) => {
      kb = options.reply_markup;
    },
    editMessageText: async (_text, options) => {
      if (options) kb = options.reply_markup;
    },
  };
  const click = async (data, owner = uid) =>
    callback({ ...ctx, from: { id: owner }, match: data.match(pattern) });
  const buttons = () => kb.inline_keyboard.flat();
  await command(ctx);
  const first = buttons()[0].callback_data,
    key = first.split(":")[2];
  await click(first, 202);
  assert.match(answer, /устарело/);
  await click(`del:t:${key}:${foreign.id}`);
  assert.match(answer, /не найден/);
  await click(first);
  assert.equal(deleted, undefined);
  await click(buttons().find((b) => b.text === "→").callback_data);
  const second = buttons()[0].callback_data;
  await click(second);
  assert.ok(buttons().some((b) => b.text === "Удалить выбранные (2)"));
  await click(`del:run:${key}`);
  assert.equal(deleted, undefined);
  await click(buttons().find((b) => b.text === "Удалить выбранные (2)").callback_data);
  const run = buttons()[0].callback_data;
  assert.notEqual(run.split(":")[2], key);
  await click(first);
  assert.match(answer, /устарело/);
  await click(run);
  assert.deepEqual(new Set(deleted.ids), new Set([first.split(":")[3], second.split(":")[3]]));
  assert.equal(deleted.owner, uid);
  assert.ok(rows.every((row) => store.getThread(uid, row.id))); // injected eraser only
  await click(run);
  assert.match(answer, /устарело/);
});
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
