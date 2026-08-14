import { InlineKeyboard } from "grammy";
import type { PendingPermission, PendingQuestion } from "../agent/permissions.js";
import { config } from "../config.js";

/**
 * callback_data ограничен 64 байтами, поэтому схема короткая:
 *   auth:<kind>   — выбор способа входа
 *   p:<id>:<act>  — решение по разрешению (a allow, w always, d deny, c comment, s stop)
 *   q:<id>:<i>    — ответ на вопрос агента
 *   m:<mode>      — режим разрешений
 *   md:<model>    — модель
 *   rs:<uuid>     — вернуться в сессию (uuid 36 символов, влезает)
 */

export function permissionKeyboard(pending: PendingPermission): InlineKeyboard {
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

export function modeKeyboard(current: string): InlineKeyboard {
  const modes: [string, string][] = [
    ["default", "🛡️ Спрашивать каждый раз"],
    ["acceptEdits", "✏️ Править файлы молча"],
    ["plan", "🗺️ Только план, без правок"],
  ];
  const kb = new InlineKeyboard();
  for (const [id, label] of modes) {
    kb.text(`${label}${id === current ? " ✓" : ""}`, `m:${id}`).row();
  }
  return kb;
}

export const MODELS: [string, string][] = [
  ["", "По умолчанию"],
  ["claude-opus-5", "Opus 5 — самая сильная"],
  ["claude-sonnet-5", "Sonnet 5 — баланс"],
  ["claude-haiku-4-5", "Haiku 4.5 — быстрая"],
];

export function modelKeyboard(current: string | null): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const [id, label] of MODELS) {
    const active = (current ?? "") === id;
    kb.text(`${label}${active ? " ✓" : ""}`, `md:${id || "default"}`).row();
  }
  return kb;
}

export function mainMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (config.miniappUrl) kb.webApp("🐱 Мой Claude-кот", config.miniappUrl).row();
  return kb;
}
