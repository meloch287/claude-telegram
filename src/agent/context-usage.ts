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

/**
 * Заполненность после хода — мгновенно, из того, что уже пришло: usage последнего
 * ответа Claude (основной ветки) и contextWindow из итога хода. getContextUsage()
 * пересчитывает всё заново и отвечает ~12 с — мост bb его не дожидался.
 */
export function contextFromTurn(lastUsage: unknown, modelUsage: unknown): ContextUsage | null {
  if (!lastUsage || typeof lastUsage !== "object" || !modelUsage || typeof modelUsage !== "object") return null;
  const u = lastUsage as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === "number" && Number.isFinite(u[k]) ? (u[k] as number) : 0);
  const total = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens") + n("output_tokens");
  const max = Math.max(0, ...Object.values(modelUsage as Record<string, { contextWindow?: unknown }>).map((m) => (typeof m?.contextWindow === "number" ? m.contextWindow : 0)));
  if (total <= 0 || max <= 0) return null;
  return { percentage: Math.round((total / max) * 100), total, max };
}
