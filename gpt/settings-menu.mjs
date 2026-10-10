import { effortsFor } from "./reasoning.mjs";
import { InlineKeyboard, GrammyError } from "grammy";
import * as legacy from "../dist/db.js";
import * as store from "./store.mjs";
import { MODELS, modelId } from "./policy.mjs";
const modes = [
  ["auto", "⚡ Без вопросов"],
  ["read", "🔎 Только чтение"],
];
export function settingsView(uid, screen) {
  const model = legacy.getOrCreateUser(uid).model || "gpt-6-sol",
    mode = store.modeFor(uid),
    kb = new InlineKeyboard();
  if (screen === "model") {
    for (const [id, label] of MODELS)
      kb.text(`${id === model ? "✓ " : ""}${label}`, `model:${id}`).row();
    kb.text("⬅️ Назад", "menu:settings");
    return {
      text: "🧠 Модель ИИ\n\nВыбери модель для следующих задач. Работа оплачивается подпиской владельца бота.",
      keyboard: kb,
    };
  }
  if (screen === "effort") {
    const current = store.effortFor(uid, model);
    for (const [id, label] of effortsFor(model))
      kb.text(`${id === current ? "✓ " : ""}${label}`, `effort:${id}`).row();
    kb.text("⬅️ Назад", "menu:settings");
    return {
      text: "⚡ Глубина размышления · Effort\n\nLow отвечает быстрее. High, XHigh и Max выделяют больше времени на сложную задачу. Ultra доступен у Sol и Astra. Более высокий уровень обычно требует больше времени и токенов.\n\nНастройка применяется к следующим задачам.",
      keyboard: kb,
    };
  }
  if (screen === "permissions") {
    for (const [id, label] of modes)
      kb.text(`${id === mode ? "✓ " : ""}${label}`, `permission:${id}`).row();
    kb.text("⬅️ Назад", "menu:settings");
    return {
      text: "🛡️ Режим разрешений\n\n⚡ Без вопросов — агент выполняет команды и меняет файлы в твоём контейнере.\n\n🔎 Только чтение — агент изучает файлы без изменений.\n\nРежим применяется к следующим задачам.",
      keyboard: kb,
    };
  }
  return {
    text: `⚙️ Настройки\n\nEffort: ${store.effortFor(uid, model)}\nМодель ИИ: ${MODELS.find(([id]) => id === model)?.[1] || model}\nРежим разрешений: ${modes.find(([id]) => id === mode)?.[1] || mode}`,
    keyboard: kb
      .text("🧠 Модель ИИ", "menu:model")
      .row()
      .text("🛡️ Режим разрешений", "menu:permissions")
      .row()
      .text("⚡ Effort · скорость и глубина", "menu:effort")
      .row()
      .text("⬅️ Назад", "menu:home"),
  };
}
export function registerSettingsMenu(bot, { homeText, homeKeyboard, display }) {
  async function show(ctx, screen) {
    const view =
      screen === "home"
        ? { text: homeText, keyboard: homeKeyboard(ctx.from.id) }
        : settingsView(ctx.from.id, screen);
    if (display) return display(ctx, view.text, view.keyboard);
    if (!ctx.callbackQuery) return ctx.reply(view.text, { reply_markup: view.keyboard });
    try {
      return await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    } catch (error) {
      if (!(error instanceof GrammyError && error.description.includes("message is not modified")))
        throw error;
    }
  }
  bot.command("model", async (ctx) => {
    if (ctx.match.trim()) legacy.setModel(ctx.from.id, modelId(ctx.match.trim()));
    await show(ctx, "model");
  });
  bot.command("permissions", async (ctx) => {
    if (ctx.match.trim()) store.setMode(ctx.from.id, ctx.match.trim());
    await show(ctx, "permissions");
  });
  bot.command("effort", async (ctx) => {
    if (ctx.match.trim())
      store.setEffort(
        ctx.from.id,
        ctx.match.trim(),
        legacy.getOrCreateUser(ctx.from.id).model || "gpt-6-sol",
      );
    await show(ctx, "effort");
  });
  bot.callbackQuery(/^effort:(.+)$/, async (ctx) => {
    store.setEffort(
      ctx.from.id,
      ctx.match[1],
      legacy.getOrCreateUser(ctx.from.id).model || "gpt-6-sol",
    );
    await ctx.answerCallbackQuery("✅ Effort сохранён");
    await show(ctx, "effort");
  });
  bot.command("settings", (ctx) => show(ctx, "settings"));
  bot.callbackQuery(/^menu:(settings|model|permissions|effort|home)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await show(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^nav:(settings|model|mode|menu)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await show(
      ctx,
      { settings: "settings", model: "model", mode: "permissions", menu: "home" }[ctx.match[1]],
    );
  });
  // Keep old model buttons functional after deployment.
  bot.callbackQuery(/^model:(.+)$/, async (ctx) => {
    legacy.setModel(ctx.from.id, modelId(ctx.match[1]));
    await ctx.answerCallbackQuery("✅ Модель выбрана");
    await show(ctx, "model");
  });
  bot.callbackQuery(/^permission:(.+)$/, async (ctx) => {
    store.setMode(ctx.from.id, ctx.match[1]);
    await ctx.answerCallbackQuery("✅ Режим сохранён");
    await show(ctx, "permissions");
  });
}
