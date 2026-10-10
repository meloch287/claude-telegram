import { details, fence, formatDuration, hideSecrets, tail, esc } from "../dist/agent/render.js";
import { sendFormatted } from "./rich-output.mjs";
const clean = (value, max = 180) => hideSecrets(String(value ?? ""), "code").slice(0, max);
const mono = (value, max = 180) => "`" + clean(value, max).replace(/[`\r\n]/g, " ") + "`";
function excerpt(value) {
  const safe = hideSecrets(String(value), "code");
  const lines = safe.split("\n");
  return (
    (lines.length > 6 ? "…(показан конец вывода)\n" : "") + tail(lines.slice(-6).join("\n"), 1000)
  );
}
function label(item) {
  switch (item.type) {
    case "command_execution":
      return `🖥️ ${mono(item.command)}`;
    case "file_change":
      return `📝 Файлы: ${
        (item.changes || [])
          .slice(0, 3)
          .map((c) => mono(c.path, 90))
          .join(", ") || "изменение"
      }`;
    case "web_search":
      return `🌐 Поиск ${mono(item.query || item.action?.query || "в интернете")}`;
    case "mcp_tool_call":
      return `🔧 ${mono([item.server, item.tool].filter(Boolean).join("/"))}`;
    default:
      return null;
  }
}
export class TaskJournal {
  #items = new Map();
  #overflow = false;
  #plan = [];
  #phase = "🧠 Работаю над задачей…";
  observe(event) {
    if (!["item.started", "item.updated", "item.completed"].includes(event.type)) return;
    const item = event.item;
    if (item?.type === "todo_list") {
      this.#plan = (item.items || [])
        .slice(0, 30)
        .map((step) => ({ text: clean(step.text, 120), done: step.completed === true }));
      return;
    }
    if (item?.type === "agent_message") this.#phase = "✍️ Готовлю ответ…";
    else if (item?.type === "reasoning") this.#phase = "🧠 Работаю над задачей…";
    else if (label(item || {})) this.#phase = "🧠 Готовлю следующий шаг…";
    if (!item?.id || !label(item)) return;
    if (!this.#items.has(item.id) && this.#items.size >= 200) {
      this.#overflow = true;
      return;
    }
    const previous = this.#items.get(item.id) || {};
    const failed =
      item.status === "failed" ||
      (Number.isInteger(item.exit_code) && item.exit_code !== 0) ||
      Boolean(item.error);
    const errorText = typeof item.error === "string" ? item.error : item.error?.message;
    this.#items.set(item.id, {
      label: label(item),
      kind: item.type,
      done: previous.done || event.type === "item.completed",
      failed: previous.failed || failed,
      output:
        typeof item.aggregated_output === "string"
          ? excerpt(item.aggregated_output)
          : previous.output,
      error: errorText ? excerpt(errorText) : previous.error,
      exit: item.exit_code ?? previous.exit,
    });
  }
  checkpoint() { return [...this.#items.values()].slice(-30).map(({label,done,failed}) => ({label,done,failed})); }
  progress({ model, durationMs }) {
    const parts = [`<b>${esc(clean(model, 80))}</b> · ${formatDuration(durationMs)}`];
    if (this.#plan.length) {
      const shown = [
        ...this.#plan.filter((s) => s.done).slice(-2),
        ...this.#plan.filter((s) => !s.done).slice(0, 3),
      ];
      parts.push(
        "<b>План</b>\n" + shown.map((s) => `${s.done ? "✅" : "⬜"} ${esc(s.text)}`).join("\n"),
      );
    }
    const items = [...this.#items.values()];
    // Keep active operations visible even when later parallel operations finish first.
    const pending = items.filter((i) => !i.done && !i.failed);
    const done = items.filter((i) => i.done || i.failed);
    const activeShown = pending.slice(-6);
    const room = 6 - activeShown.length;
    const shown = [...(room ? done.slice(-room) : []), ...activeShown];
    if (shown.length) {
      const lines = shown.map(
        (i) =>
          `${i.failed ? "⚠️" : i.done ? "✅" : "⏳"} ${esc(i.label).replace(/`([^`]*)`/g, "<code>$1</code>")}${i.failed && i.exit != null ? ` · код ${i.exit}` : ""}`,
      );
      parts.push("<b>Действия</b>\n" + lines.join("\n"));
      if (items.length > shown.length || this.#overflow)
        parts.push(
          `<i>Ещё ${items.length - shown.length}${this.#overflow ? "+" : ""} действий — в итоговом журнале.</i>`,
        );
    }
    if (!pending.length) parts.push(this.#phase);
    return parts.join("\n\n");
  }
  render({ success, cancelled = false, durationMs, tokens = 0, usage, quotaUnits }) {
    const state = cancelled
      ? "⏹ Остановлено"
      : success
        ? "✅ Готово"
        : "⚠️ Задача завершилась с ошибкой";
    const parts = [
      `${state} · ${formatDuration(durationMs)} · ${Math.max(0, tokens).toLocaleString("ru-RU")} токенов`,
    ];
    if (usage) {
      const count = (n) => n.toLocaleString("ru-RU");
      parts[0] = `${state} · ${formatDuration(durationMs)}\n📊 Обработано за задачу: ${count(usage.input_tokens + usage.output_tokens)} токенов\nВход: ${count(usage.input_tokens)} (из них кеш: ${count(usage.cached_input_tokens)}); выход: ${count(usage.output_tokens)}.`;
    }
    if (usage === null)
      parts[0] = `${state} · ${formatDuration(durationMs)}\n📊 Расход токенов не удалось подтвердить.`;
    if (quotaUnits !== undefined)
      parts[0] += `\n🎟 Квота задачи: ${quotaUnits.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ед.`;
    const items = [...this.#items.values()];
    if (!items.length) return parts[0];
    const steps = items
      .slice(0, 24)
      .map(
        (i) =>
          `${i.done && !i.failed ? "- [x]" : "- [ ]"} ${i.failed ? "⚠️ " : !i.done ? "⏸ " : ""}${i.label}${i.failed && i.exit != null ? ` · код ${i.exit}` : ""}`,
      );
    if (items.length > 24 || this.#overflow)
      steps.push(`- …ещё ${items.length - 24}${this.#overflow ? "+" : ""} шагов`);
    parts.push(details(`☑️ Шаги (${items.length}${this.#overflow ? "+" : ""})`, steps.join("\n")));
    const outputs = items.filter((i) => i.kind === "command_execution" && i.output && !i.failed);
    if (outputs.length)
      parts.push(
        details(
          `🖥️ Вывод команд (${outputs.length})`,
          outputs
            .slice(-4)
            .map((i) => `${i.label}\n\n${fence(i.output)}`)
            .join("\n\n"),
        ),
      );
    const errors = items.filter((i) => i.failed);
    if (errors.length)
      parts.push(
        details(
          `⚠️ Ошибки инструментов (${errors.length})`,
          errors
            .slice(-3)
            .map(
              (i) =>
                `${i.label}\n\n${fence(i.error || i.output || `Код завершения: ${i.exit ?? "неизвестен"}`)}`,
            )
            .join("\n\n"),
        ),
      );
    return parts.join("\n\n");
  }
}
export async function finishTaskMessage(api, uid, statusId, summary) {
  // Send at the end of the conversation, then remove the stale progress card.
  await sendFormatted(api, uid, summary);
  await api.deleteMessage(uid, statusId).catch(() => {});
}
