import { randomBytes } from "node:crypto";
import { InlineKeyboard, type Bot, type Context } from "grammy";

export interface DeleteChoice { id: string; title: string; project: string }
export interface DeleteResult { deleted: string[]; failed: string[]; mirrorUpdated: boolean }
export interface DeleteOperations {
  list(userId: number): Promise<DeleteChoice[]>;
  remove(userId: number, ids: string[]): Promise<DeleteResult>;
}
interface Menu {
  nonce: string;
  chatId: number;
  messageId: number;
  at: number;
  rows: DeleteChoice[];
  selected: Set<string>;
  page: number;
  confirm: boolean;
}
const pageSize = 10;
const nonce = () => randomBytes(4).toString("hex");
const description = "🗑 Удаление чатов Claude\n\nОтметь один или несколько диалогов. Показаны все твои проекты.\n\nУдалятся переписка, вложения, созданные файлы, репозитории, сборки и кеш выбранных диалогов Claude.";

export function registerClaudeDeleteMenu(bot: Bot<Context>, operations: DeleteOperations) {
  const menus = new Map<number, Menu>();
  const keyboard = (s: Menu) => {
    const kb = new InlineKeyboard();
    for (const row of s.rows.slice(s.page * pageSize, (s.page + 1) * pageSize)) {
      const label = `${s.selected.has(row.id) ? "☑" : "☐"} ${row.title.slice(0, 32)}`;
      kb.text(label, `cdel:t:${s.nonce}:${row.id}`).row();
    }
    if (s.page > 0) kb.text("←", `cdel:p:${s.nonce}:${s.page - 1}`);
    if ((s.page + 1) * pageSize < s.rows.length) kb.text("→", `cdel:p:${s.nonce}:${s.page + 1}`);
    kb.row();
    if (s.selected.size) kb.text(`Удалить выбранные (${s.selected.size})`, `cdel:ask:${s.nonce}`).row();
    return kb.text("Отмена", `cdel:cancel:${s.nonce}`);
  };
  const open = async (ctx: Context) => {
    if (ctx.chat?.type !== "private") return ctx.reply("Удалять чаты можно в личной переписке с ботом.");
    try {
      const rows = await operations.list(ctx.from!.id);
      if (!rows.length) return ctx.reply("Чатов Claude для удаления нет.");
      const s: Menu = { nonce: nonce(), chatId: ctx.chat.id, messageId: 0, at: Date.now(), rows, selected: new Set(), page: 0, confirm: false };
      for (const [uid, old] of menus) if (Date.now() - old.at > 15 * 60_000) menus.delete(uid);
      const message = await ctx.reply(description, { reply_markup: keyboard(s) });
      s.messageId = message.message_id;
      menus.set(ctx.from!.id, s);
    } catch {
      await ctx.reply("Не удалось загрузить чаты Claude. Повтори /delete.");
    }
  };
  bot.command("delete", open);
  bot.callbackQuery(/^cdel:(t|p|ask|run|cancel):([a-f0-9]{8})(?::(.+))?$/, async ctx => {
    const uid = ctx.from.id, s = menus.get(uid);
    const [, action, key, arg] = ctx.match;
    if (!s || s.nonce !== key || s.chatId !== ctx.chat?.id || s.messageId !== ctx.callbackQuery.message?.message_id || Date.now() - s.at > 15 * 60_000)
      return ctx.answerCallbackQuery("Меню устарело. Открой /delete заново.");
    if (action === "cancel") {
      menus.delete(uid);
      await ctx.answerCallbackQuery();
      return ctx.editMessageText("Удаление отменено.");
    }
    if (action === "run") {
      if (!s.confirm || !s.selected.size) return ctx.answerCallbackQuery("Сначала выбери чаты и подтверди удаление.");
      menus.delete(uid);
      await ctx.answerCallbackQuery("Удаляю…");
      await ctx.editMessageText(`Удаляю чаты Claude: ${s.selected.size}…`);
      try {
        const result = await operations.remove(uid, [...s.selected]);
        const remaining = (await operations.list(uid)).length;
        await ctx.editMessageText(
          `Удалено чатов Claude: ${result.deleted.length}. Осталось: ${remaining}.` +
          (result.failed.length ? `\nНе удалось удалить: ${result.failed.length}. Повтори /delete.` : "") +
          (!result.mirrorUpdated ? "\nОбщий список истории обновится при следующем открытии." : "") +
          (remaining ? "\nПродолжить другой чат — /resume." : "\nНапиши сообщение, чтобы начать новый диалог."),
        );
      } catch (error) {
        await ctx.editMessageText(error instanceof Error ? error.message : "Не удалось удалить чаты. Повтори /delete.");
      }
      return;
    }
    if (s.confirm) return ctx.answerCallbackQuery("Подтверди удаление или нажми «Отмена».");
    if (action === "t") {
      if (!arg || !s.rows.some(r => r.id === arg)) return ctx.answerCallbackQuery("Диалог недоступен.");
      if (s.selected.has(arg)) s.selected.delete(arg);
      else if (s.selected.size < 100) s.selected.add(arg);
      else return ctx.answerCallbackQuery("За один раз можно удалить до 100 чатов.");
    }
    if (action === "p") {
      const page = Number(arg);
      if (!Number.isSafeInteger(page) || page < 0 || page * pageSize >= s.rows.length) return ctx.answerCallbackQuery();
      s.page = page;
    }
    await ctx.answerCallbackQuery();
    if (action === "ask") {
      if (!s.selected.size) return;
      s.confirm = true; s.nonce = nonce();
      const titles = s.rows.filter(r => s.selected.has(r.id)).map(r => `• ${r.title} · ${r.project}`).join("\n");
      await ctx.editMessageText(`Удалить чаты Claude: ${s.selected.size}?\n\n${titles.slice(0, 2600)}\n\nИх история и все файлы в папках этих диалогов будут удалены. Отменить это действие нельзя.`, {
        reply_markup: new InlineKeyboard().text("Да, удалить", `cdel:run:${s.nonce}`).row().text("Отмена", `cdel:cancel:${s.nonce}`),
      });
    } else await ctx.editMessageReplyMarkup({ reply_markup: keyboard(s) });
  });
  return { open };
}
