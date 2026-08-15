import { InlineKeyboard } from "grammy";
import type { PendingPermission, PendingQuestion } from "../agent/permissions.js";

/**
 * callback_data ограничен 64 байтами, поэтому схема короткая:
 *   auth:<kind>   — выбор способа входа
 *   p:<id>:<act>  — решение по разрешению (a allow, w always, d deny, c comment, s stop)
 *   q:<id>:<i>    — ответ на вопрос агента
 *   nav:<экран>   — переход между экранами
 *   m:<mode>      — режим разрешений
 *   md:<model>    — модель
 *   rs:<uuid>     — вернуться в сессию (uuid 36 символов, влезает)
 */

export function permissionKeyboard(pending: PendingPermission): InlineKeyboard {
  // Утверждение плана — не «разрешение инструменту», а решение по существу.
  // Слова «Разрешить ExitPlanMode» тут ничего не объясняют.
  if (pending.toolName === "ExitPlanMode") {
    return new InlineKeyboard()
      .text("✅ План принят, работай", `p:${pending.id}:a`)
      .row()
      .text("✍️ Поправить план", `p:${pending.id}:c`)
      .text("⏹️ Отмена", `p:${pending.id}:s`);
  }

  const kb = new InlineKeyboard()
    .text("✅ Разрешить", `p:${pending.id}:a`)
    .text("🚫 Отклонить", `p:${pending.id}:d`)
    .row();

  // «Всегда» показываем только если SDK действительно прислал правило,
  // которое можно сохранить, — иначе кнопка врала бы.
  const persistable = pending.suggestions.some(
    (s) => s.destination === "localSettings" || s.destination === "session",
  );
  if (persistable) kb.text("♾️ Всегда разрешать это", `p:${pending.id}:w`).row();

  kb.text("✍️ Отклонить и объяснить", `p:${pending.id}:c`).text("⏹️ Стоп", `p:${pending.id}:s`);
  return kb;
}

export function questionKeyboard(pending: PendingQuestion): InlineKeyboard {
  const kb = new InlineKeyboard();
  const current = pending.questions[pending.index];
  if (!current) return kb;
  current.options.forEach((option, index) => {
    kb.text(option.label, `q:${pending.id}:${index}`).row();
  });
  return kb;
}

export const MODELS: [string, string][] = [
  ["", "По умолчанию"],
  ["claude-fable-5", "Fable 5 — самая умная"],
  ["claude-opus-5", "Opus 5 — сильная"],
  ["claude-sonnet-5", "Sonnet 5 — баланс"],
  ["claude-haiku-4-5", "Haiku 4.5 — быстрая"],
];


/**
 * Подтверждение коммита. Сообщение придумала модель, и последнее слово должно
 * остаться за человеком: коммит с чужой формулировкой потом читать ему.
 */
export function commitKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Закоммитить", `gc:${id}:y`)
    .text("🚫 Отмена", `gc:${id}:n`);
}
