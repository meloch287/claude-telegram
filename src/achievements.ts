import { getModeData } from "./db.js";
import type { Mode } from "./mode-data.js";
import { ACHIEVEMENTS, CAT_LEVELS, catForTokens } from "./cats.js";
import {
  getOrCreateUser,
  listAchievements,
  seeProject,
  touchStreak,
  unlockAchievement,
} from "./db.js";

export interface UnlockedAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
}

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

function grant(userId: number, id: string, out: UnlockedAchievement[], engine: Mode = "claude"): void {
  if (!getModeData(engine).unlock(userId, id)) return;
  const achievement = BY_ID.get(id);
  if (achievement) out.push(achievement);
}

export type AchievementEvent =
  | { type: "message"; hour: number }
  | { type: "tool"; toolName: string; allowed: boolean }
  | { type: "interrupt" }
  | { type: "project"; project: string }
  /** Расход токенов: собственных ачивок не даёт, но проверяет пороговые. */
  | { type: "usage" };

/**
 * Проверяет условия после события и возвращает то, что открылось прямо сейчас.
 * Возвращает только новые ачивки — их бот показывает пользователю.
 */
export function checkAchievements(userId: number, event: AchievementEvent, engine: Mode = "claude"): UnlockedAchievement[] {
  const unlocked: UnlockedAchievement[] = [];
  const user = getModeData(engine).stats(userId);

  switch (event.type) {
    case "message": {
      grant(userId, "first_blood", unlocked, engine);
      if (event.hour >= 2 && event.hour < 5) grant(userId, "night_owl", unlocked, engine);
      if (user.total_messages >= 100) grant(userId, "hundred_msgs", unlocked, engine);
      const streak = getModeData(engine).streak(userId);
      if (streak >= 7) grant(userId, "streak_7", unlocked, engine);
      break;
    }
    case "tool": {
      if (event.allowed) {
        grant(userId, "first_tool", unlocked, engine);
        if (event.toolName === "Bash") grant(userId, "first_bash", unlocked, engine);
        if (event.toolName === "Edit" || event.toolName === "Write") {
          grant(userId, "first_edit", unlocked, engine);
        }
      } else {
        grant(userId, "first_deny", unlocked, engine);
      }
      break;
    }
    case "interrupt":
      grant(userId, "interrupter", unlocked, engine);
      break;
    case "project": {
      const count = getModeData(engine).project(userId, event.project);
      if (count >= 3) grant(userId, "polyglot", unlocked, engine);
      break;
    }
    case "usage":
      break;
  }

  // Пороговые ачивки проверяем после любого события — расход мог измениться.
  if (user.total_tokens >= 1_000_000) grant(userId, "million", unlocked, engine);
  const maxLevel = CAT_LEVELS[CAT_LEVELS.length - 1]!;
  if (catForTokens(user.total_tokens).level === maxLevel.level) {
    grant(userId, "max_cat", unlocked, engine);
  }

  return unlocked;
}

export function unlockedIds(userId: number, engine: Mode = "claude"): Set<string> {
  return new Set(getModeData(engine).achievements(userId).map((row) => row.achievement));
}

export function renderUnlocked(items: UnlockedAchievement[]): string {
  if (items.length === 0) return "";
  const lines = items.map((a) => `${a.icon} <b>${a.name}</b> — ${a.description}`);
  return `🏆 ${items.length === 1 ? "Новое достижение" : "Новые достижения"}:\n${lines.join("\n")}`;
}
