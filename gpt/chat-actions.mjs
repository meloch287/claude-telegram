// Small, source-based reminders: no extra model run and no invented completion status.
const escapeHtml = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function clip(value, limit) {
  const chars = Array.from(value);
  return chars.length > limit ? chars.slice(0, limit - 1).join("") + "…" : value;
}
function excerpt(value, limit) {
  const text = String(value || "")
    .slice(0, 16000)
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, " [код] ")
    .replace(/\[\[file:[^\]]*\]\]/g, " [файл] ")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*>]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*`_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return escapeHtml(clip(text, limit));
}
export function renderChatRecap({ thread, firstPrompt = "", recent = [] }) {
  const parts = [`↩️ <b>${escapeHtml(clip(thread.title, 100))}</b>`];
  const topic = firstPrompt || thread.summary;
  if (topic) parts.push(`🧭 <b>О чём чат</b>\n${excerpt(topic, 200)}`);
  const lastUser = recent.findLastIndex((m) => m.role === "user" && m.body?.trim());
  const lastAssistant = recent.findLastIndex((m) => m.role === "assistant" && m.body?.trim());
  if (lastUser >= 0)
    parts.push(`💬 <b>Последняя просьба</b>\n${excerpt(recent[lastUser].body, 230)}`);
  if (lastAssistant >= 0)
    parts.push(
      `📌 <b>${lastAssistant > lastUser ? "Последний ответ" : "Предыдущий ответ"}</b>\n${excerpt(recent[lastAssistant].body, 340)}`,
    );
  if (!topic && lastUser < 0 && lastAssistant < 0)
    parts.push("Пока нет сообщений — начни с первой задачи.");
  else parts.push("<i>Напиши сообщение — продолжим.</i>");
  return parts.join("\n\n");
}
export function registerChatActions(bot, { store, show }) {
  bot.command("rename", async (ctx) => {
    const uid = ctx.from.id,
      row = store.peekActiveThread(uid),
      options = { parse_mode: "HTML" };
    if (!row)
      return show(ctx, "Выбери чат через /chats или создай новый — /new.", undefined, options);
    const title = clip(
      String(ctx.match || "")
        .replace(/\s+/g, " ")
        .trim(),
      100,
    );
    if (!title)
      return show(
        ctx,
        `✏️ <b>Переименовать чат</b>\n\nСейчас: ${escapeHtml(row.title)}\n\nОтправь <code>/rename Новое название</code>`,
        undefined,
        options,
      );
    store.renameThread(uid, row.id, title);
    await show(ctx, `✅ Чат переименован\n\n<b>${escapeHtml(title)}</b>`, undefined, options);
  });
  bot.callbackQuery(/^chat:(.+)$/, async (ctx) => {
    const uid = ctx.from.id,
      id = ctx.match[1];
    store.selectThread(uid, id);
    await ctx.answerCallbackQuery();
    const recap = store.threadRecap(uid, id);
    if (!recap) return show(ctx, "Диалог уже удалён. Выбери другой через /chats.");
    await show(ctx, renderChatRecap(recap), undefined, { parse_mode: "HTML" });
  });
}
