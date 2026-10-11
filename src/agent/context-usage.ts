export interface ContextUsage { percentage: number; total: number; max: number }

/**
 * Заполненность контекста из ответа SDK. getContextUsage() отдаёт camelCase
 * (totalTokens, rawMaxTokens), а context_usage в сообщениях — snake_case
 * (total_tokens, raw_max_tokens). Читали только второе — и получали «0 из 0»:
 * /context в Telegram и индикатор bb молчали.
 */
export function readContextUsage(raw: unknown): ContextUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const num = (...keys: string[]) => {
    for (const k of keys) if (typeof u[k] === "number" && Number.isFinite(u[k])) return u[k] as number;
    return null;
  };
  const percentage = num("percentage");
  if (percentage === null) return null;
  return { percentage, total: num("totalTokens", "total_tokens") ?? 0, max: num("rawMaxTokens", "raw_max_tokens", "maxTokens", "max_tokens") ?? 0 };
}
