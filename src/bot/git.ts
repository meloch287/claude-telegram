import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { activeProxyUrl } from "../proxy.js";
import { config } from "../config.js";
import { credentialEnv, type Credential } from "../auth.js";

const run = promisify(execFile);

/** Локальные операции быстрые; push и создание PR идут по сети через прокси. */
const LOCAL_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MS = 3 * 60_000;

/**
 * Окружение для git и gh.
 *
 * Токен подставляется credential-хелпером из переменной окружения, а не пишется
 * в ~/.gitconfig: том с домашним каталогом переживает пересборку, и секрет
 * осел бы в нём насовсем.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  const proxy = activeProxyUrl();
  for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) {
    if (proxy) env[key] = proxy;
    else delete env[key];
  }

  if (config.githubToken) {
    env.GITHUB_TOKEN = config.githubToken;
    env.GH_TOKEN = config.githubToken;
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "credential.https://github.com.helper";
    env.GIT_CONFIG_VALUE_0 =
      "!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f";
  }
  return env;
}

/** Токен не должен попасть ни в лог, ни в сообщение об ошибке. */
export function hideToken(text: string): string {
  return text.replace(/\/\/[^@/\s]+@/g, "//***@");
}

async function git(repo: string, args: string[], timeout = LOCAL_TIMEOUT_MS): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", repo, ...args], { timeout, env: gitEnv() });
    return stdout;
  } catch (error) {
    const parts = error as { stderr?: string; message?: string };
    throw new Error(hideToken((parts.stderr || parts.message || String(error)).trim()), {
      cause: error,
    });
  }
}

/**
 * Ищет репозиторий в папке проекта.
 *
 * Сам проект репозиторием обычно не является: /clone кладёт код в подпапку.
 * Поэтому сперва смотрим на корень, потом на подпапки первого уровня. Если
 * репозиториев несколько, выбирать должен пользователь, а не мы за него.
 */
export function findRepos(cwd: string): string[] {
  if (existsSync(join(cwd, ".git"))) return [cwd];
  if (!existsSync(cwd)) return [];
  return readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(cwd, entry.name, ".git")))
    .map((entry) => join(cwd, entry.name));
}

export interface RepoStatus {
  branch: string;
  /** Строки в формате git status --porcelain. */
  entries: { code: string; path: string }[];
  ahead: number;
  behind: number;
  remote: string | null;
}

export async function status(repo: string): Promise<RepoStatus> {
  const branch = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const porcelain = await git(repo, ["status", "--porcelain"]);
  const entries = porcelain
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2).trim() || "?", path: line.slice(3) }));

  let ahead = 0;
  let behind = 0;
  let remote: string | null = null;
  try {
    remote = (await git(repo, ["rev-parse", "--abbrev-ref", "@{upstream}"])).trim();
    const counts = (await git(repo, ["rev-list", "--left-right", "--count", `${remote}...HEAD`]))
      .trim()
      .split(/\s+/);
    behind = Number(counts[0] ?? 0);
    ahead = Number(counts[1] ?? 0);
  } catch {
    // Ветки нет на сервере — это нормально для только что созданной.
  }
  return { branch, entries, ahead, behind, remote };
}

export interface DiffSummary {
  /** Строки git diff --stat: файл и сколько в нём изменилось. */
  stat: string;
  /** Сам дифф, обрезанный до разумного размера. */
  patch: string;
  truncated: boolean;
  files: number;
}

const PATCH_LIMIT = 12_000;

/**
 * Дифф вместе с неотслеживаемыми файлами: без них картина врёт — только что
 * созданный файл в git diff не виден вовсе, а для пользователя это изменение.
 */
export async function diff(repo: string): Promise<DiffSummary> {
  const stat = (await git(repo, ["diff", "HEAD", "--stat"])).trim();
  const untracked = (await git(repo, ["ls-files", "--others", "--exclude-standard"]))
    .split("\n")
    .filter(Boolean);

  let patch = await git(repo, ["diff", "HEAD"]);
  const files = new Set(
    stat
      .split("\n")
      .slice(0, -1)
      .map((line) => line.split("|")[0]?.trim())
      .filter(Boolean) as string[],
  );
  for (const path of untracked) files.add(path);

  const truncated = patch.length > PATCH_LIMIT;
  if (truncated) patch = patch.slice(0, PATCH_LIMIT);

  const statWithUntracked = untracked.length
    ? `${stat}${stat ? "\n" : ""}новых файлов: ${untracked.length} (${untracked.slice(0, 5).join(", ")}${untracked.length > 5 ? "…" : ""})`
    : stat;

  return { stat: statWithUntracked, patch, truncated, files: files.size };
}

/**
 * Коммит всего изменённого, включая новые файлы.
 *
 * Сообщение уходит одним аргументом -m: execFile запускает git напрямую, без
 * шелла, поэтому кавычки, переводы строк и всё прочее из пользовательского
 * текста интерпретировать некому.
 */
export async function commitAll(repo: string, message: string): Promise<string> {
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-m", message]);
  return (await git(repo, ["rev-parse", "--short", "HEAD"])).trim();
}

export async function push(repo: string): Promise<string> {
  const branch = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  // -u нужен для веток, которых на сервере ещё нет: иначе push просит указать
  // remote руками, а из чата это неудобно.
  return git(repo, ["push", "-u", "origin", branch], NETWORK_TIMEOUT_MS);
}

export interface PrResult {
  url: string;
}

/**
 * PR через gh: он сам подставит владельца, базовую ветку и токен из окружения.
 * Нам остаётся не забыть отправить ветку — без неё gh откажет.
 */
export async function createPr(repo: string, title: string, body: string): Promise<PrResult> {
  await push(repo);
  try {
    const { stdout } = await run(
      "gh",
      ["pr", "create", "--title", title, "--body", body, "--fill-first"],
      { cwd: repo, timeout: NETWORK_TIMEOUT_MS, env: gitEnv() },
    );
    const url = /https:\/\/github\.com\/\S+/.exec(stdout)?.[0] ?? stdout.trim();
    return { url };
  } catch (error) {
    const parts = error as { stderr?: string; message?: string };
    const text = hideToken((parts.stderr || parts.message || String(error)).trim());
    const wrapped = new Error(text, { cause: error });
    // Самый частый случай: PR уже открыт. Тогда полезнее ссылка, а не ошибка.
    if (/already exists/i.test(text)) {
      const { stdout } = await run("gh", ["pr", "view", "--json", "url", "--jq", ".url"], {
        cwd: repo,
        timeout: NETWORK_TIMEOUT_MS,
        env: gitEnv(),
      });
      return { url: stdout.trim() };
    }
    throw wrapped;
  }
}

/**
 * Сообщение коммита, написанное моделью по самому диффу.
 *
 * Это отдельный короткий вызов, а не реплика в диалоге пользователя: иначе
 * служебная просьба «придумай сообщение» осела бы в контексте чата и мешала
 * основной задаче. Инструменты выключены — модели нужен только текст.
 */
export async function suggestCommitMessage(
  repo: string,
  credential: Credential,
  model: string | null,
): Promise<string | null> {
  const { stat, patch } = await diff(repo);
  if (!stat && !patch) return null;

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(gitEnv())) {
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(credentialEnv(credential))) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  const prompt = [
    "Напиши сообщение коммита для этих изменений.",
    "",
    "Требования: одна строка до 72 символов, на русском, в настоящем времени,",
    "по сути изменения, без префиксов вроде feat/fix и без кавычек.",
    "В ответе — только сама строка, без пояснений.",
    "",
    "Статистика:",
    stat || "(пусто)",
    "",
    "Дифф:",
    patch.slice(0, 8000) || "(пусто)",
  ].join("\n");

  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const session = query({
      prompt,
      options: {
        cwd: repo,
        ...(model ? { model } : {}),
        allowedTools: [],
        // Ни скиллов, ни CLAUDE.md: это разовая просьба, а не работа в проекте.
        settingSources: [],
        env,
      },
    });

    let text = "";
    for await (const message of session) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") text += block.text;
        }
      }
    }
    const line = text
      .trim()
      .split("\n")
      .find((l) => l.trim().length > 0);
    return line
      ? line
          .trim()
          .replace(/^["'«»]|["'«»]$/g, "")
          .slice(0, 200)
      : null;
  } catch (error) {
    console.error("не удалось предложить сообщение коммита:", (error as Error).message);
    return null;
  }
}
