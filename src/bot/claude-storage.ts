import { hasClaudeWork } from "./claude-work.js";
import { randomBytes } from "node:crypto";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { gptStorage, type StorageReport } from "../engine.js";
import { getSession, backgroundTasks, stopBackgroundTask, reloadClaudeSettings } from "./session.js";
const cleaning = new Set<number>();
export const isClaudeCleaning = (uid: number) => cleaning.has(uid);
const size = (n: number) => (n / 1e9).toFixed(2) + " ГБ";
function report(s: StorageReport) {
  return `💾 Место на сервере\n\nЗанято: ${size(s.bytes)}\nУчитываются твои файлы GPT и Claude, вложения, история и кеш.\n\n` +
    (s.blocked ? "⛔ Очисти место до 10 ГБ, чтобы продолжить работу." : s.warning ? "⚠️ Занято больше 20 ГБ. Удали ненужные диалоги или очисти кеш. При превышении 30 ГБ задачи блокируются до очистки до 10 ГБ." : "Предупреждение — после 20 ГБ. Блокировка — после 30 ГБ, до очистки до 10 ГБ.");
}
export function registerClaudeStorage(bot: Bot<Context>, openDelete: (ctx: Context) => Promise<unknown>) {
  const pending = new Map<number, { nonce: string; at: number; messageId: number }>();
  const keys = () => new InlineKeyboard().text("🔄 Проверить снова", "cdisk:show").row().text("🗑 Удалить чаты и файлы", "cdisk:dialogs").row().text("🧹 Очистить кеш", "cdisk:ask");
  const show = async (ctx: Context) => {
    if (ctx.chat?.type !== "private") return;
    const message = await ctx.reply("Считаю место на диске…");
    try { await ctx.api.editMessageText(ctx.chat.id, message.message_id, report(await gptStorage(ctx.from!.id)), { reply_markup: keys() }); }
    catch { await ctx.api.editMessageText(ctx.chat.id, message.message_id, "Не удалось проверить место. Повтори /storage."); }
  };
  bot.command("storage", show);
  bot.callbackQuery(/^cdisk:(show|dialogs|ask|cancel|run:([a-f0-9]{12}))$/, async ctx => {
    const uid = ctx.from.id, action = ctx.match[1];
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery("Открой личный чат с ботом.");
    await ctx.answerCallbackQuery();
    if (action === "show") return show(ctx);
    if (action === "dialogs") return openDelete(ctx);
    if (action === "cancel") { pending.delete(uid); return ctx.editMessageText("Очистка отменена.", { reply_markup: keys() }); }
    if (action === "ask") {
      const nonce = randomBytes(6).toString("hex");
      pending.set(uid, { nonce, at: Date.now(), messageId: ctx.callbackQuery.message!.message_id });
      return ctx.editMessageText("Очистить кеш и временные файлы GPT и Claude?\n\nФайлы проектов и переписка сохранятся. Сначала заверши текущие задачи.", { reply_markup: new InlineKeyboard().text("Очистить кеш", `cdisk:run:${nonce}`).row().text("Отмена", "cdisk:cancel") });
    }
    const s = pending.get(uid);
    if (!s || s.nonce !== ctx.match[2] || s.messageId !== ctx.callbackQuery.message?.message_id || Date.now() - s.at > 15 * 60000) return ctx.editMessageText("Подтверждение устарело. Открой /storage.");
    pending.delete(uid);
    if (hasClaudeWork(uid) || getSession(uid)?.conversation.busy || backgroundTasks(uid).length) return ctx.editMessageText("Заверши задачи Claude через /stop и /bg, затем повтори /storage.");
    cleaning.add(uid);
    try {
      await reloadClaudeSettings(uid);
      await ctx.editMessageText("Очищаю кеш…");
      await ctx.editMessageText(report(await gptStorage(uid, "cache")), { reply_markup: keys() });
    } catch { await ctx.editMessageText("Очистка не завершена. Повтори /storage."); }
    finally { cleaning.delete(uid); }
  });
  return { show };
}
export async function stopClaudeForStorage(uid: number): Promise<void> {
  const session = getSession(uid);
  if (session) await session.conversation.close();
  for (const task of backgroundTasks(uid)) await stopBackgroundTask(uid, task.id);
}
