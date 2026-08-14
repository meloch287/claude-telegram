/**
 * Три плана, между которыми пользователь выбирает при первом запуске.
 *
 * Это планы БОТА, а не подписка Anthropic: они описывают, какую модель бот
 * использует, сколько токенов в сутки готов потратить и какие инструменты
 * разрешает. Оплата в любом случае идёт по API-ключу (своему или владельца) —
 * Agent SDK не умеет работать от подписки claude.ai.
 */

export type TierId = "free" | "pro" | "max";

export interface Tier {
  id: TierId;
  title: string;
  emoji: string;
  model: string;
  /** Суточный лимит токенов (вход + выход + кэш). */
  dailyTokenBudget: number;
  /** Инструменты, которые вообще доступны агенту на этом плане. */
  tools: string[];
  /** Инструменты, одобряемые без вопросов. Остальные уходят в кнопки. */
  autoApprove: string[];
  /** Можно ли переключаться в acceptEdits (правки без подтверждения). */
  allowAcceptEdits: boolean;
  description: string;
  bullets: string[];
}

const READ_ONLY = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "AskUserQuestion", "TodoWrite"];
const WRITE = [...READ_ONLY, "Edit", "Write", "NotebookEdit"];
const FULL = [...WRITE, "Bash", "Task"];

export const TIERS: Record<TierId, Tier> = {
  free: {
    id: "free",
    title: "Free",
    emoji: "🌱",
    model: "claude-haiku-4-5",
    dailyTokenBudget: 200_000,
    tools: READ_ONLY,
    autoApprove: ["Read", "Glob", "Grep", "TodoWrite"],
    allowAcceptEdits: false,
    description: "Посмотреть, спросить, разобраться. Ничего не меняет на диске.",
    bullets: [
      "Модель Haiku 4.5 — быстрая и дешёвая",
      "200 000 токенов в сутки",
      "Только чтение: Read, Grep, Glob, поиск в вебе",
      "Файлы не правит, команды не запускает",
    ],
  },
  pro: {
    id: "pro",
    title: "Pro",
    emoji: "⚡",
    model: "claude-sonnet-5",
    dailyTokenBudget: 2_000_000,
    tools: WRITE,
    autoApprove: ["Read", "Glob", "Grep", "TodoWrite", "WebSearch"],
    allowAcceptEdits: true,
    description: "Рабочий режим: правит код, но каждую правку показывает и спрашивает.",
    bullets: [
      "Модель Sonnet 5",
      "2 000 000 токенов в сутки",
      "Правит и создаёт файлы — с подтверждением кнопкой",
      "Можно включить режим «правки без вопросов»",
      "Bash недоступен",
    ],
  },
  max: {
    id: "max",
    title: "Max",
    emoji: "🚀",
    model: "claude-opus-5",
    dailyTokenBudget: 10_000_000,
    tools: FULL,
    autoApprove: ["Read", "Glob", "Grep", "TodoWrite", "WebSearch"],
    allowAcceptEdits: true,
    description: "Всё, что умеет Claude Code: терминал, субагенты, длинные автономные задачи.",
    bullets: [
      "Модель Opus 5 — самая сильная",
      "10 000 000 токенов в сутки",
      "Bash с подтверждением каждой команды",
      "Субагенты для параллельной работы",
      "Все режимы разрешений, включая план-режим",
    ],
  },
};

export const TIER_ORDER: TierId[] = ["free", "pro", "max"];

export function isTierId(value: string): value is TierId {
  return value === "free" || value === "pro" || value === "max";
}

export function renderTierCard(tier: Tier): string {
  const bullets = tier.bullets.map((b) => `  • ${b}`).join("\n");
  return `${tier.emoji} <b>${tier.title}</b>\n${tier.description}\n\n${bullets}`;
}
