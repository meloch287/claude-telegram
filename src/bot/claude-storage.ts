import { hasClaudeWork } from "./claude-work.js";
import { randomBytes } from "node:crypto";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { gptStorage, gptStoragePreview, type StorageReport, type StorageCleanup } from "../engine.js";
import { getSession, backgroundTasks, stopBackgroundTask, reloadClaudeSettings } from "./session.js";
const cleaning = new Set<number>();
export const isClaudeCleaning = (uid: number) => cleaning.has(uid);
const size = (n: number) => (n / 1e9).toFixed(2) + " ГБ";
/** Названия частей — те же, что в /storage GPT (gpt/storage-menu.mjs). */
const LABELS: Record<string, string> = {
  projects: "Файлы проектов", uploads: "Загрузки", cache: "Кеш и временные", history: "История GPT",
  claude_history: "История Claude", shared: "Общие блоки копий", bb_copies: "Копии проектов bb",
  claude_env: "Программы Claude", service: "Служебное bb (не в счёт)", other: "Прочие файлы",
};
const CLEANUPS: Record<Exclude<StorageCleanup, "cache">, { button: string; title: string; note: string }> = {
  bb_copies: { button: "🗂 Копии проектов bb", title: "Удалить копии проектов, которые bb сделал для тредов?", note: "Сами треды, переписка и проекты в рабочей зоне останутся — удалятся только эти копии." },
  claude_env: { button: "🧰 Программы Claude", title: "Удалить программы и окружения, которые ставил Claude?", note: "Python-окружения, OCR, пакеты и рабочие папки в домашней папке Claude. Переписка, вход и GitHub останутся; нужное Claude поставит заново." },
};
function report(s: StorageReport) {
  const parts = Object.entries(s.categories || {}).filter(([, n]) => n >= 1e6).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `• ${LABELS[k] ?? k}: ${size(n)}`).join("\n");
  // Раньше здесь была одна цифра: 6,5 ГБ «прочих» у Али нельзя было ни понять, ни удалить.
  return `💾 Место на сервере\n\nЗанято: ${size(s.bytes)}\n${parts ? parts + "\n" : ""}Учитываются твои файлы GPT и Claude, вложения, история и кеш.\n\n` +
    (s.blocked ? "⛔ Очисти место до 10 ГБ, чтобы продолжить работу." : s.warning ? "⚠️ Занято больше 20 ГБ. Удали ненужные диалоги или очисти кеш. При превышении 30 ГБ задачи блокируются до очистки до 10 ГБ." : "Предупреждение — после 20 ГБ. Блокировка — после 30 ГБ, до очистки до 10 ГБ.");
}
export function registerClaudeStorage(bot: Bot<Context>, openDelete: (ctx: Context) => Promise<unknown>) {
  const pending = new Map<number, { nonce: string; at: number; messageId: number; kind: StorageCleanup }>();
  const keys = () => new InlineKeyboard().text("🔄 Проверить снова", "cdisk:show").row().text("🗑 Удалить чаты и файлы", "cdisk:dialogs").row().text("🧹 Очистить кеш", "cdisk:ask")
    .row().text(CLEANUPS.bb_copies.button, "cdisk:ask:bb_copies").row().text(CLEANUPS.claude_env.button, "cdisk:ask:claude_env");
  const show = async (ctx: Context) => {
    if (ctx.chat?.type !== "private") return;
    const message = await ctx.reply("Считаю место на диске…");
    try { await ctx.api.editMessageText(ctx.chat.id, message.message_id, report(await gptStorage(ctx.from!.id)), { reply_markup: keys() }); }
    catch { await ctx.api.editMessageText(ctx.chat.id, message.message_id, "Не удалось проверить место. Повтори /storage."); }
  };
  bot.command("storage", show);
  bot.callbackQuery(/^cdisk:(show|dialogs|ask(?::(bb_copies|claude_env))?|cancel|run:([a-f0-9]{12}))$/, async ctx => {
    const uid = ctx.from.id, action = ctx.match[1];
    if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery("Открой личный чат с ботом.");
    await ctx.answerCallbackQuery();
    if (action === "show") return show(ctx);
    if (action === "dialogs") return openDelete(ctx);
    if (action === "cancel") { pending.delete(uid); return ctx.editMessageText("Очистка отменена.", { reply_markup: keys() }); }
    if (action?.startsWith("ask")) {
      const kind = (ctx.match[2] ?? "cache") as StorageCleanup;
      const nonce = randomBytes(6).toString("hex");
      let text = "Очистить кеш и временные файлы GPT и Claude?\n\nФайлы проектов и переписка сохранятся. Сначала заверши текущие задачи.";
      if (kind !== "cache") {
        const c = CLEANUPS[kind];
        let items;
        try { items = (await gptStoragePreview(uid))[kind] ?? []; } catch { return ctx.editMessageText("Не удалось посмотреть, что удалится. Повтори /storage.", { reply_markup: keys() }); }
        const total = items.reduce((n, x) => n + x.bytes, 0);
        if (!total) return ctx.editMessageText(`${c.button}: удалять нечего.`, { reply_markup: keys() });
        const list = items.slice(0, 8).map((x) => `• ${(x.items?.[0] ?? x.name).slice(0, 40)} — ${size(x.bytes)}`).join("\n");
        text = `${c.title}\n\n${list}${items.length > 8 ? `\n…и ещё ${items.length - 8}` : ""}\nВсего: ${size(total)}\n\n${c.note} Отменить удаление нельзя. Сначала заверши текущие задачи.`;
      }
      pending.set(uid, { nonce, at: Date.now(), messageId: ctx.callbackQuery.message!.message_id, kind });
      return ctx.editMessageText(text, { reply_markup: new InlineKeyboard().text(kind === "cache" ? "Очистить кеш" : "Да, удалить", `cdisk:run:${nonce}`).row().text("Отмена", "cdisk:cancel") });
    }
    const s = pending.get(uid);
    if (!s || s.nonce !== ctx.match[3] || s.messageId !== ctx.callbackQuery.message?.message_id || Date.now() - s.at > 15 * 60000) return ctx.editMessageText("Подтверждение устарело. Открой /storage.");
    pending.delete(uid);
    if (hasClaudeWork(uid) || getSession(uid)?.conversation.busy || backgroundTasks(uid).length) return ctx.editMessageText("Заверши задачи Claude через /stop и /bg, затем повтори /storage.");
    cleaning.add(uid);
    try {
      await reloadClaudeSettings(uid);
      await ctx.editMessageText(s.kind === "cache" ? "Очищаю кеш…" : "Удаляю…");
      await ctx.editMessageText(report(await gptStorage(uid, s.kind)), { reply_markup: keys() });
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
