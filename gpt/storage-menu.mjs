import { InlineKeyboard } from "grammy";
import { randomBytes } from "node:crypto";
const GB = 1e9;
const escape = (s) =>
  String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const size = (n) => (n / GB).toFixed(2);
const categories = {
  projects: "Файлы проектов",
  uploads: "Загрузки",
  cache: "Кеш и временные",
  history: "История GPT",
  claude_history: "История Claude",
  shared: "Общие блоки копий",
  other: "Прочие файлы",
};
export function storageReport(report, threads = []) {
  const line = (name, bytes) => name.slice(0, 21).padEnd(22) + size(bytes).padStart(7) + " ГБ";
  const table = Object.entries(report.categories || {})
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => line(categories[key] || key, n));
  table.push(line("Всего на диске", report.bytes));
  const names = new Map(threads.map((t) => [t.id, t.title]));
  const dialogs = Object.entries(report.dialogs || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, n]) =>
      line((names.get(id) || "Файлы старого диалога").replace(/[\n\r\t]/g, " "), n),
    );
  return (
    `💾 <b>Твоё место на сервере</b>\n\n<pre>${escape(table.join("\n"))}</pre>` +
    (dialogs.length ? `\nКрупнейшие диалоги:\n<pre>${escape(dialogs.join("\n"))}</pre>` : "") +
    `\n${report.blocked ? "⛔ Задачи и загрузки остановлены. Очисти до 10 ГБ, затем нажми «Проверить снова»." : report.warning ? "⚠️ Занято больше 20 ГБ. Освободи место до 10 ГБ. При превышении 30 ГБ задачи блокируются." : "✅ Места достаточно. Предупреждение — выше 20 ГБ, блокировка — выше 30 ГБ."}` +
    (report.checkedAt
      ? `\nПроверено: ${new Date(report.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.`
      : "") +
    "\n\nУчитываются сжатые блоки твоих файлов. Копии внутри пользователя считаются один раз. Размеры диалогов могут пересекаться: удаление одной копии не всегда освобождает все её блоки. Общий образ Docker и служебные данные файловой системы не включены."
  );
}
export function registerStorageMenu(bot, { guard, threads, openDelete }) {
  const sessions = new Map();
  const keyboard = new InlineKeyboard()
    .text("🔄 Проверить снова", "disk:show")
    .row()
    .text("🧹 Очистить кеш", "disk:ask:cache")
    .row()
    .text("🗑 Выбрать диалоги", "disk:dialogs")
    .row()
    .text("📁 Прочие файлы", "disk:ask:other");
  async function show(ctx, edit = false) {
    const sent = edit
      ? await ctx.editMessageText("🔎 Считаю место на диске…")
      : await ctx.reply("🔎 Считаю место на диске…");
    try {
      const r = await guard.refresh(ctx.from.id);
      await ctx.api.editMessageText(
        ctx.chat.id,
        sent.message_id,
        storageReport(r, threads(ctx.from.id)),
        { parse_mode: "HTML", reply_markup: keyboard },
      );
    } catch {
      await ctx.api.editMessageText(
        ctx.chat.id,
        sent.message_id,
        "Не удалось измерить место. Повтори /storage. Данные не удалены.",
      );
    }
  }
  bot.command("storage", (ctx) => show(ctx));
  bot.callbackQuery(
    /^disk:(show|dialogs|cancel|ask:(cache|other)|run:([a-f0-9]{12}))$/,
    async (ctx) => {
      const uid = ctx.from.id,
        action = ctx.match[1];
      await ctx.answerCallbackQuery();
      if (action === "show") return show(ctx, true);
      if (action === "dialogs") return openDelete(ctx);
      if (action === "cancel") {
        sessions.delete(uid);
        return ctx.editMessageText("Очистка отменена.", { reply_markup: keyboard });
      }
      if (action.startsWith("ask:")) {
        const kind = ctx.match[2],
          nonce = randomBytes(6).toString("hex");
        sessions.set(uid, { kind, nonce, at: Date.now() });
        return ctx.editMessageText(
          kind === "cache"
            ? "Удалить кеш и временные файлы всех твоих диалогов? История и файлы проектов останутся. Текущая работа будет остановлена."
            : "Удалить прочие файлы из корня твоей рабочей и домашней папки? Это включает общие установки программ и старые проекты вне папок диалогов. Файлы внутри диалогов и подключение ChatGPT останутся. Отменить удаление нельзя. Текущая работа будет остановлена.",
          {
            reply_markup: new InlineKeyboard()
              .text("Да, очистить", `disk:run:${nonce}`)
              .row()
              .text("Отмена", "disk:cancel"),
          },
        );
      }
      const s = sessions.get(uid);
      if (!s || s.nonce !== ctx.match[3] || Date.now() - s.at > 15 * 60000)
        return ctx.editMessageText("Подтверждение устарело. Открой /storage.");
      sessions.delete(uid);
      await ctx.editMessageText("🧹 Останавливаю задачи и очищаю выбранные данные…");
      try {
        const r = await guard.clean(uid, s.kind);
        await ctx.editMessageText(storageReport(r, threads(uid)), {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      } catch {
        await ctx.editMessageText(
          "Очистка не завершена. Повтори /storage для проверки и повторной попытки.",
        );
      }
    },
  );
  return { keyboard, report: (uid, r) => storageReport(r, threads(uid)) };
}
