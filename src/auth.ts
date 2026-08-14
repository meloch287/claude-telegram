/**
 * Способы входа. Их два, и они соответствуют тому, как логинится обычный
 * Claude Code в терминале.
 *
 * 1. Подписка. `claude setup-token` на машине, где можно пройти браузерный
 *    вход, выдаёт долгоживущий токен (команда прямо говорит: «requires Claude
 *    subscription»). Токен передаётся процессу агента как CLAUDE_CODE_OAUTH_TOKEN,
 *    и работа идёт по лимитам подписки, а не по счётчику API.
 *
 * 2. API-ключ. Обычный ANTHROPIC_API_KEY, оплата по токенам.
 *
 * Запрет из документации SDK — про то, чтобы предлагать вход через claude.ai
 * пользователям своего продукта. Личный бот, который поднимает твой же Claude
 * Code под твоим же логином, к этому не относится: бот не выдаёт чужим людям
 * доступ к подписке, он лишь передаёт дальше твой собственный токен.
 */

export type AuthKind = "subscription" | "api";

export interface Credential {
  kind: AuthKind;
  secret: string;
}

/**
 * Переменные окружения для подпроцесса агента.
 *
 * Лишний ключ нужно не просто не задать, а стереть: `env` заменяет окружение
 * подпроцесса целиком, и унаследованный ANTHROPIC_API_KEY перебил бы токен
 * подписки — работа молча пошла бы по API и по деньгам.
 */
export function credentialEnv(credential: Credential): Record<string, string | undefined> {
  if (credential.kind === "subscription") {
    return { CLAUDE_CODE_OAUTH_TOKEN: credential.secret, ANTHROPIC_API_KEY: undefined };
  }
  return { ANTHROPIC_API_KEY: credential.secret, CLAUDE_CODE_OAUTH_TOKEN: undefined };
}

/**
 * Токен от `claude setup-token` — `sk-ant-oat01-…`.
 *
 * Проверять его нужно ДО ключа API: шаблон ключа шире и накрывает токен
 * подписки целиком. Ошибка в порядке стоила рабочего бота — токен подписки
 * уходил как ANTHROPIC_API_KEY, и Anthropic отвечал «API key is invalid».
 */
export function looksLikeOauthToken(text: string): boolean {
  return /^sk-ant-oat\d*-[A-Za-z0-9_-]{20,}$/.test(text.trim());
}

/** Ключ API — тот же префикс, но без `oat`. */
export function looksLikeApiKey(text: string): boolean {
  const value = text.trim();
  if (looksLikeOauthToken(value)) return false;
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(value);
}

/**
 * Определяет вид секрета по форме. Форма подписочного токена однозначна,
 * поэтому она и решает; если не опознали — возвращаем null, и вызывающий
 * берёт то, что выбрал пользователь кнопкой.
 */
export function detectKind(text: string): AuthKind | null {
  if (looksLikeOauthToken(text)) return "subscription";
  if (looksLikeApiKey(text)) return "api";
  return null;
}

export function describeKind(kind: AuthKind): string {
  return kind === "subscription" ? "подписка Claude" : "API-ключ";
}

/** Показываем только хвост — чтобы опознать, какой доступ загружен. */
export function maskSecret(secret: string): string {
  if (secret.length <= 12) return "•".repeat(secret.length);
  return `${secret.slice(0, 8)}…${secret.slice(-4)}`;
}
