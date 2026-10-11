import { test } from "node:test";
import assert from "node:assert/strict";
import { registerStorageMenu, storageReport, cleanupPreview } from "./storage-menu.mjs";
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
      preview: async () => ({ bb_copies: [{ name: "thr_x", bytes: 4.8e9, items: ["IngCheckUp"] }], claude_env: [] }),
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
  assert.equal("disk:ask:other".match(pattern), null, "опасной «прочие файлы» больше нет");
  // копии проектов bb: перед удалением видно, что и сколько
  await click("disk:ask:bb_copies");
  assert.match(last, /IngCheckUp\s+4\.80 ГБ/);
  assert.match(last, /треды, переписка и твои проекты .* останутся/);
  await click(kb.inline_keyboard[0][0].callback_data);
  assert.deepEqual(cleared.at(-1), { uid: 202, kind: "bb_copies" });
  // удалять нечего — не просим подтверждения
  await click("disk:ask:claude_env");
  assert.match(last, /удалять нечего/);
  assert.equal(cleared.length, 2);
  await click("disk:cancel");
  assert.equal(cleared.length, 2);
  assert.ok(storageReport(report, [{ id: "a", title: "<private>" }]).includes("&lt;private&gt;"));
  assert.ok(storageReport({ bytes: 1e9, categories: { bb_copies: 4.8e9, service: 1e9 }, dialogs: { "bb:thr_x": 4.8e9 } }).includes("Копия проекта bb"));
  assert.equal(cleanupPreview("claude_env", { claude_env: [{ name: ".mamba", bytes: 9e8 }] }).total, 9e8);
});
