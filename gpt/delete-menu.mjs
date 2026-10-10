import { randomBytes } from "node:crypto";
import { InlineKeyboard } from "grammy";
import * as store from "./store.mjs";
import { deleteDialogs, retryDeletions } from "./deletion.mjs";
const sessions = new Map();
const nonce = () => randomBytes(4).toString("hex");
const pageSize = 10;
function keyboard(uid, s) {
  const rows = store.listThreads(uid, s.page * pageSize),
    kb = new InlineKeyboard();
  for (const row of rows.slice(0, pageSize))
    kb.text(
      `${s.selected.has(row.id) ? "☑" : "☐"} ${row.title.slice(0, 30)}${store.storageLedger.get(uid)?.dialogs?.[row.id] ? " · " + (store.storageLedger.get(uid).dialogs[row.id] / 1e9).toFixed(2) + " ГБ" : ""}`,
      `del:t:${s.nonce}:${row.id}`,
    ).row();
  if (s.page > 0) kb.text("←", `del:p:${s.nonce}:${s.page - 1}`);
  if (rows.length > pageSize) kb.text("→", `del:p:${s.nonce}:${s.page + 1}`);
  kb.row();
  if (s.selected.size)
    kb.text(`Удалить выбранные (${s.selected.size})`, `del:ask:${s.nonce}`).row();
  return kb.text("Отмена", `del:cancel:${s.nonce}`);
}
export function registerDeleteMenu(bot, operations = { deleteDialogs, retryDeletions }) {
  const open = async (ctx) => {
    const uid = ctx.from.id;
    if (store.pendingDeletions(uid).length) {
      const result = await operations.retryDeletions(uid);
      if (result.failed.length)
        return ctx.reply(
          "Очистка пока не завершилась. Повтори /delete — удаление продолжится, данные других чатов не затронуты.",
        );
    }
    if (!store.threadCount(uid)) return ctx.reply("Диалогов для удаления нет.");
    const s = { nonce: nonce(), selected: new Set(), page: 0, at: Date.now(), confirm: false };
    sessions.set(uid, s);
    await ctx.reply(
      "Выбери диалоги для полного удаления. Можно отметить несколько на разных страницах. Переписка, сессии, файлы и серверные резервные копии выбранных диалогов будут удалены.",
      { reply_markup: keyboard(uid, s) },
    );
  };
  bot.command("delete", open);
  bot.callbackQuery(/^del:(t|p|ask|run|cancel):([a-f0-9]{8})(?::(.+))?$/, async (ctx) => {
    const uid = ctx.from.id,
      [, action, key, arg] = ctx.match,
      s = sessions.get(uid);
    if (!s || s.nonce !== key || Date.now() - s.at > 15 * 60_000)
      return ctx.answerCallbackQuery("Меню устарело. Открой /delete снова.");
    if (action === "cancel") {
      sessions.delete(uid);
      await ctx.answerCallbackQuery();
      return ctx.editMessageText("Удаление отменено.");
    }
    if (action === "run") {
      if (!s.confirm || !s.selected.size) return ctx.answerCallbackQuery("Сначала выбери диалоги.");
      sessions.delete(uid);
      await ctx.answerCallbackQuery("Удаляю…");
      await ctx.editMessageText(`Удаляю ${s.selected.size} диалогов и их файлы…`);
      try {
        const result = await operations.deleteDialogs(uid, [...s.selected]);
        await operations.after?.(uid);
        await ctx.editMessageText(
          `Удалено диалогов: ${result.deleted.length}. Осталось: ${store.threadCount(uid)}.${result.failed.length ? "\nНе вся очистка завершилась. Повтори /delete для продолжения." : "\nПереписка, рабочие файлы, сессии и копии на сервере удалены."}`,
        );
      } catch (error) {
        await ctx.editMessageText(`Удаление не завершено: ${error.message}\nПовторить: /delete`);
      }
      return;
    }
    if (s.confirm) return ctx.answerCallbackQuery("Подтверди удаление или нажми «Отмена».");
    if (action === "t") {
      if (!store.getThread(uid, arg)) return ctx.answerCallbackQuery("Диалог не найден.");
      if (s.selected.has(arg)) s.selected.delete(arg);
      else s.selected.add(arg);
    }
    if (action === "p") {
      const page = Number(arg);
      if (!Number.isSafeInteger(page) || page < 0) return ctx.answerCallbackQuery();
      s.page = page;
    }
    await ctx.answerCallbackQuery();
    if (action === "ask") {
      if (!s.selected.size) return;
      const rows = store.validateDeletion(uid, [...s.selected]);
      s.confirm = true;
      s.nonce = nonce();
      const titles = rows.map((r) => `• ${r.title}`).join("\n");
      await ctx.editMessageText(
        `Удалить навсегда ${rows.length} диалогов?\n${titles.slice(0, 2800)}\n\nИх файлы, история и серверные копии тоже будут удалены. Отменить это действие нельзя. Работа в выбранном диалоге будет остановлена.`,
        {
          reply_markup: new InlineKeyboard()
            .text("Да, удалить навсегда", `del:run:${s.nonce}`)
            .row()
            .text("Отмена", `del:cancel:${s.nonce}`),
        },
      );
    } else await ctx.editMessageReplyMarkup({ reply_markup: keyboard(uid, s) });
  });
  return { open };
}
