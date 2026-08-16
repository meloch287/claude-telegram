import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Читает .env вручную: SDK и grammy не подтягивают его сами,
 * а тащить dotenv ради двадцати строк парсинга незачем.
 */
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(resolve(process.cwd(), ".env"));

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Не задана переменная окружения ${name}. Скопируй .env.example в .env и заполни.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

const allowedUserIds = optional("ALLOWED_USER_IDS", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const id = Number(s);
    if (!Number.isInteger(id)) throw new Error(`ALLOWED_USER_IDS: "${s}" — не число`);
    return id;
  });

export const config = {
  botToken: required("BOT_TOKEN"),
  allowedUserIds,
  encryptionKey: required("ENCRYPTION_KEY"),
  workspaceRoot: resolve(process.cwd(), optional("WORKSPACE_ROOT", "./workspaces")),
  dataDir: resolve(process.cwd(), optional("DATA_DIR", "./data")),
  miniappPort: Number(optional("MINIAPP_PORT", "8788")),
  miniappUrl: optional("MINIAPP_URL", ""),
  permissionTimeoutMs: Number(optional("PERMISSION_TIMEOUT_MIN", "30")) * 60_000,
  /** Пул прокси через запятую. Порядок задаёт приоритет. */
  proxyPool: optional("PROXY_POOL", ""),
  /** Код страны, которую ожидаем от выхода: DE и т.п. Пусто — не проверять. */
  proxyRequireCountry: optional("PROXY_REQUIRE_COUNTRY", ""),
  /** Токен GitHub: им клонируются приватные репозитории и работает gh. */
  githubToken: optional("GITHUB_TOKEN", ""),

  /**
   * Расшифровка голосовых. Адрес сервиса с интерфейсом OpenAI
   * (POST /v1/audio/transcriptions). Пусто — бот честно скажет, что не настроено.
   */
  whisperUrl: optional("WHISPER_URL", ""),
  whisperModel: optional("WHISPER_MODEL", ""),
  whisperToken: optional("WHISPER_TOKEN", ""),
  /** Слать голос через тот же прокси, что и запросы к Anthropic. Обычно не нужно. */
  whisperViaProxy: optional("WHISPER_VIA_PROXY", "") === "1",

  /**
   * Озвучка ответов. Адрес сервиса с интерфейсом OpenAI (POST /v1/audio/speech).
   * По умолчанию берётся от адреса расшифровки: у одного и того же сервиса это
   * соседние ручки, и заставлять писать почти тот же адрес дважды незачем.
   */
  ttsUrl: optional("TTS_URL", optional("WHISPER_URL", "").replace(/transcriptions$/, "speech")),
  ttsModel: optional("TTS_MODEL", ""),
  ttsVoice: optional("TTS_VOICE", ""),
  ttsToken: optional("TTS_TOKEN", optional("WHISPER_TOKEN", "")),
  ttsViaProxy: optional("TTS_VIA_PROXY", "") === "1",

  /**
   * Потолки окон подписки в токенах. Нужны, чтобы показывать «сколько из 100%».
   *
   * Своё число, а не от Anthropic: настоящий процент приходит с claude.ai, а он
   * с этого сервера отдаёт проверку Cloudflare — датацентровые адреса он не
   * пускает. Поэтому знаменатель задаёт владелец и видит, от чего считается.
   * Ноль — потолок не задан, процент не показываем.
   */
  limitFiveHourTokens: Number(optional("LIMIT_FIVE_HOUR_TOKENS", "0")),
  limitSevenDayTokens: Number(optional("LIMIT_SEVEN_DAY_TOKENS", "0")),

  /** Файл с описанием MCP-серверов в формате Claude Code. */
  mcpConfigPath: optional("MCP_CONFIG", resolve(process.cwd(), "mcp.json")),
} as const;

if (config.allowedUserIds.length === 0) {
  console.warn(
    "⚠️  ALLOWED_USER_IDS пустой — бот отвечает кому угодно. На сервере это шелл для любого, кто найдёт бота.",
  );
}
