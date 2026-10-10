import { test } from "node:test";
import assert from "node:assert/strict";
import { registerStorageMenu, storageReport } from "./storage-menu.mjs";
test("storage cleanup requires a fresh confirmation owned by the caller; cannot replay", async () => {
  let callback,
    pattern,
    kb,
    cleared = [],
    last;
  const report = {
    bytes: 31e9,
    blocked: true,
    categories: { projects: 31e9 },
    dialogs: { a: 31e9 },
  };
  registerStorageMenu(
    {
      command() {},
      callbackQuery(p, fn) {
        pattern = p;
        callback = fn;
      },
    },
    {
      guard: {
        refresh: async () => report,
        clean: async (uid, kind) => {
          cleared.push({ uid, kind });
          return { ...report, bytes: 5e9, blocked: false };
        },
      },
      threads: () => [{ id: "a", title: "<private>" }],
      openDelete: async () => {},
    },
  );
  const ctx = {
    from: { id: 202 },
    answerCallbackQuery: async () => {},
    editMessageText: async (text, opts) => {
      last = text;
      if (opts) kb = opts.reply_markup;
    },
  };
  const click = (data, uid = 202) =>
    callback({ ...ctx, from: { id: uid }, match: data.match(pattern) });
  await click("disk:ask:cache");
  assert.equal(cleared.length, 0);
  const action = kb.inline_keyboard[0][0].callback_data;
  await click(action, 303);
  assert.equal(cleared.length, 0);
  assert.match(last, /устарело/);
  await click(action);
  assert.deepEqual(cleared, [{ uid: 202, kind: "cache" }]);
  await click(action);
  assert.equal(cleared.length, 1);
  await click("disk:ask:other");
  await click("disk:cancel");
  assert.equal(cleared.length, 1);
  assert.ok(storageReport(report, [{ id: "a", title: "<private>" }]).includes("&lt;private&gt;"));
});
