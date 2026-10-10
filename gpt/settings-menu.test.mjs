import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InlineKeyboard } from "grammy";
const dir = mkdtempSync(join(tmpdir(), "gpt-settings-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  BOT_TOKEN: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  ALLOWED_USER_IDS: "1057399602",
});
const legacy = await import("../dist/db.js"),
  store = await import("./store.mjs");
const { registerSettingsMenu } = await import("./settings-menu.mjs");
test("model, permissions and back navigate in one message and persist only the caller settings", async () => {
  const commands = new Map(),
    callbacks = [];
  let keyboard,
    body,
    replies = 0,
    edits = 0;
  registerSettingsMenu(
    {
      command: (name, fn) => commands.set(name, fn),
      callbackQuery: (pattern, fn) => callbacks.push({ pattern, fn }),
    },
    {
      homeText: "Главное меню",
      homeKeyboard: () => new InlineKeyboard().text("Настройки", "menu:settings"),
    },
  );
  assert.ok(commands.has("model"), "The /model command must open a navigable menu");
  const ctx = {
    from: { id: 101 },
    match: "",
    reply: async (text, options) => {
      body = text;
      keyboard = options.reply_markup;
      replies++;
    },
    editMessageText: async (text, options) => {
      body = text;
      keyboard = options.reply_markup;
      edits++;
    },
    answerCallbackQuery: async () => {},
  };
  const press = async (data) => {
    const entry = callbacks.find((x) =>
      typeof x.pattern === "string" ? data === x.pattern : x.pattern.test(data),
    );
    assert.ok(entry, `Missing handler ${data}`);
    await entry.fn({
      ...ctx,
      callbackQuery: { data },
      match: typeof entry.pattern === "string" ? data : data.match(entry.pattern),
    });
  };
  const buttons = () => keyboard.inline_keyboard.flat();
  await commands.get("model")(ctx);
  assert.ok(buttons().some((b) => /Назад/.test(b.text) && b.callback_data === "menu:settings"));
  await press("model:gpt-6-astra");
  assert.equal(legacy.getOrCreateUser(101).model, "gpt-6-astra");
  assert.ok(buttons().some((b) => b.text.includes("✓") && b.callback_data === "model:gpt-6-astra"));
  await press("menu:settings");
  assert.ok(buttons().some((b) => b.text.includes("Модель ИИ")));
  assert.ok(buttons().some((b) => b.text.includes("Режим разрешений")));
  await press("menu:permissions");
  await press("permission:read");
  assert.equal(store.modeFor(101), "read");
  assert.equal(store.modeFor(202), "auto");
  assert.ok(buttons().some((b) => b.text.includes("✓") && b.callback_data === "permission:read"));
  await assert.rejects(press("permission:unsafe"));
  assert.equal(store.modeFor(101), "read");
  await press("menu:settings");
  await press("menu:home");
  assert.equal(body, "Главное меню");
  assert.equal(replies, 1);
  assert.ok(edits >= 6);
  await commands.get("permissions")({ ...ctx, match: "auto" });
  assert.equal(store.modeFor(101), "auto");
  assert.ok(buttons().some((b) => /Назад/.test(b.text)));
  assert.equal(store.threadCount(101), 0, "Settings must not create dialogs");
});
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
