import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { activeProxyUrl } from "../proxy.js";
import { config } from "../config.js";

const run = promisify(execFile);

/** Клонирование большого репозитория идёт через прокси и бывает небыстрым. */
const TIMEOUT_MS = 5 * 60_000;

/** Имя папки из адреса: последний сегмент без .git. */
function folderName(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  const name = basename(withoutQuery.replace(/\.git$/, "").replace(/\/+$/, ""));
  return name || "repo";
}

/** Токен в адресе не должен попасть ни в лог, ни в сообщение об ошибке. */
export function hideToken(text: string): string {
  return text.replace(/\/\/[^@/\s]+@/g, "//***@");
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

  // Прокси нужен и git: до GitHub с этого сервера дорога та же, что до Anthropic.
  const proxy = activeProxyUrl();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {}),
  };

  // Сохранённый токен подставляется сам: вставлять его в адрес руками — значит
  // оставить секрет в истории чата.
  if (config.githubToken) {
    env.GITHUB_TOKEN = config.githubToken;
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "credential.https://github.com.helper";
    env.GIT_CONFIG_VALUE_0 =
      '!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f';
  }

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
