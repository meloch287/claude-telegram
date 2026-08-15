import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { gitEnv, hideToken } from "./git.js";

export { hideToken };

const run = promisify(execFile);

/** Клонирование большого репозитория идёт через прокси и бывает небыстрым. */
const TIMEOUT_MS = 5 * 60_000;

/** Имя папки из адреса: последний сегмент без .git. */
function folderName(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  const name = basename(withoutQuery.replace(/\.git$/, "").replace(/\/+$/, ""));
  return name || "repo";
}

/**
 * Забирает репозиторий в рабочую папку проекта.
 *
 * Клонируем поверхностно: агенту нужен код, а не вся история, и на общем
 * сервере место в дефиците. Если папка уже есть — обновляем её, а не плодим
 * копии с суффиксами.
 */
export async function cloneRepository(url: string, cwd: string): Promise<string> {
  const name = folderName(url);
  const target = join(cwd, name);

  // Прокси и токен — те же, что у остальных операций с git: до GitHub с этого
  // сервера дорога та же, что до Anthropic, а секрет подставляет credential-хелпер.
  const env = gitEnv();

  try {
    if (existsSync(join(target, ".git"))) {
      await run("git", ["-C", target, "pull", "--ff-only"], { timeout: TIMEOUT_MS, env });
      return `${name} (обновлён)`;
    }
    await run("git", ["clone", "--depth", "50", url, target], { timeout: TIMEOUT_MS, env });
    return name;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(hideToken(message));
  }
}
