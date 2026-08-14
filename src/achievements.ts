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

function grant(userId: number, id: string, out: UnlockedAchievement[]): void {
  if (!unlockAchievement(userId, id)) return;
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
export function checkAchievements(userId: number, event: AchievementEvent): UnlockedAchievement[] {
  const unlocked: UnlockedAchievement[] = [];
  const user = getOrCreateUser(userId);

  switch (event.type) {
    case "message": {
      grant(userId, "first_blood", unlocked);
      if (event.hour >= 2 && event.hour < 5) grant(userId, "night_owl", unlocked);
      if (user.total_messages >= 100) grant(userId, "hundred_msgs", unlocked);
      const streak = touchStreak(userId);
      if (streak >= 7) grant(userId, "streak_7", unlocked);
      break;
    }
    case "tool": {
      if (event.allowed) {
        grant(userId, "first_tool", unlocked);
        if (event.toolName === "Bash") grant(userId, "first_bash", unlocked);
        if (event.toolName === "Edit" || event.toolName === "Write") {
          grant(userId, "first_edit", unlocked);
        }
      } else {
        grant(userId, "first_deny", unlocked);
      }
      break;
    }
    case "interrupt":
      grant(userId, "interrupter", unlocked);
      break;
    case "project": {
      const count = seeProject(userId, event.project);
      if (count >= 3) grant(userId, "polyglot", unlocked);
      break;
    }
    case "usage":
      break;
  }

  // Пороговые ачивки проверяем после любого события — расход мог измениться.
  if (user.total_tokens >= 1_000_000) grant(userId, "million", unlocked);
  const maxLevel = CAT_LEVELS[CAT_LEVELS.length - 1]!;
  if (catForTokens(user.total_tokens).level === maxLevel.level) {
    grant(userId, "max_cat", unlocked);
  }

  return unlocked;
}

export function unlockedIds(userId: number): Set<string> {
  return new Set(listAchievements(userId).map((row) => row.achievement));
}

export function renderUnlocked(items: UnlockedAchievement[]): string {
  if (items.length === 0) return "";
  const lines = items.map((a) => `${a.icon} <b>${a.name}</b> — ${a.description}`);
  return `🏆 ${items.length === 1 ? "Новое достижение" : "Новые достижения"}:\n${lines.join("\n")}`;
}
