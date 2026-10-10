import { readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { query, type ModelInfo, type EffortLevel, type Options } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import { credentialFor, getOrCreateUser } from "./db.js";
import { credentialEnv } from "./auth.js";
import { spawnWorker, workerFor } from "./agent/isolation.js";
import { activeProxyUrl } from "./proxy.js";
import { INSTALLED_CLAUDE_MODELS, CLAUDE_CODE_VERSION } from "./claude-catalog.js";

export type ClaudeThinking = "auto" | "enabled" | "disabled";
export interface ClaudePreferences {
  model: string;
  effort: EffortLevel | null;
  thinking: ClaudeThinking;
  /**
   * Оркестрация агентами (ultracode): большие задачи модель сама раскладывает
   * на воркфлоу с субагентами и перепроверкой. Тратит заметно больше лимита,
   * поэтому по умолчанию выключена и включается человеком в мини-аппе.
   */
  orchestration: boolean;
}
const file = join(config.dataDir, "claude-preferences.json");
const effortValues = new Set(["low", "medium", "high", "xhigh", "max"]);
let preferences: Record<string, ClaudePreferences> = {};
try {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [uid, value] of Object.entries(raw)) {
      if (!/^\d+$/.test(uid) || !value || typeof value !== "object") continue;
      const entry = value as Partial<ClaudePreferences>;
      if (typeof entry.model === "string" && (entry.effort === null || effortValues.has(entry.effort ?? "")) && ["auto", "enabled", "disabled"].includes(entry.thinking ?? "")) preferences[uid] = { ...(entry as ClaudePreferences), orchestration: entry.orchestration === true };
    }
  }
} catch { }
const catalogs = new Map<number, { models: ModelInfo[]; checkedAt: number }>();
const refreshing = new Map<number, Promise<ModelInfo[]>>();
/**
 * Уровень Max пользователям бота не показываем: по замерам Anthropic он почти
 * не лучше XHigh, а думает вдвое дольше и съедает лимит. Сохранённый Max
 * превращается в «Авто» (claudePreferences отбрасывает неподдерживаемый уровень).
 */
const hiddenEfforts = new Set(["max"]);
function withoutHiddenEfforts(models: ModelInfo[]): ModelInfo[] {
  return models.map(m => m.supportedEffortLevels ? { ...m, supportedEffortLevels: m.supportedEffortLevels.filter(level => !hiddenEfforts.has(level)) } : m);
}
const installedModels = withoutHiddenEfforts(INSTALLED_CLAUDE_MODELS);
export function claudeModels(uid: number): ModelInfo[] {
  return catalogs.get(uid)?.models ?? installedModels;
}
export async function refreshClaudeModels(uid: number): Promise<ModelInfo[]> {
  const existing = catalogs.get(uid);
  if (existing && Date.now() - existing.checkedAt < 3600_000) return existing.models;
  if (refreshing.has(uid)) return refreshing.get(uid)!;
  const job = (async () => {
    const credential = credentialFor(uid), proxy = activeProxyUrl();
    if (!credential || !proxy) return claudeModels(uid);
    const worker = workerFor(uid), abort = new AbortController();
    let finish: (() => void) | undefined;
    const prompt = { async *[Symbol.asyncIterator]() { await new Promise<void>(resolve => { finish = resolve; }); } };
    const instance = query({ prompt, options: {
      cwd: worker.home, persistSession: false, settingSources: ["user"], abortController: abort,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: worker.home, USER: worker.name, LANG: "C.UTF-8", HTTP_PROXY: proxy, HTTPS_PROXY: proxy, NO_PROXY: "localhost,127.0.0.1", ...credentialEnv(credential) },
      spawnClaudeCodeProcess: options => spawnWorker(uid, options),
    } });
    const timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const models = await instance.supportedModels();
      if (!models.length) throw Error("Claude Code не вернул список моделей");
      const visible = withoutHiddenEfforts(models);
      catalogs.set(uid, { models: visible, checkedAt: Date.now() });
      return visible;
    } finally { clearTimeout(timer); finish?.(); instance.close(); }
  })().finally(() => refreshing.delete(uid));
  refreshing.set(uid, job);
  return job;
}
export function claudePreferences(uid: number): ClaudePreferences {
  const old = getOrCreateUser(uid).model;
  const migrated = claudeModels(uid).find(m => m.value === old || m.resolvedModel === old);
  const saved = preferences[String(uid)] ?? { model: migrated?.value ?? "default", effort: null, thinking: "auto", orchestration: false };
  const model = claudeModels(uid).find(m => m.value === saved.model) ?? claudeModels(uid)[0]!;
  // Мышление всегда как в Claude Code (адаптивное): отдельный выключатель убран.
  return { model: model.value, effort: model.supportedEffortLevels?.includes(saved.effort!) ? saved.effort : null, thinking: "auto", orchestration: saved.orchestration === true };
}
export function saveClaudePreferences(uid: number, patch: Record<string, unknown>): ClaudePreferences {
  if (Object.keys(patch).some(k => !["model", "effort", "thinking", "orchestration"].includes(k))) throw Error("Неизвестная настройка Claude");
  if (patch.orchestration !== undefined && typeof patch.orchestration !== "boolean") throw Error("Оркестрация включается или выключается");
  const old = claudePreferences(uid);
  const selected = patch.model ?? old.model;
  const model = claudeModels(uid).find(m => m.value === selected || m.resolvedModel === selected);
  if (!model) throw Error("Выбери модель из списка Claude Code");
  // Старые клиенты ещё могут прислать thinking — принимаем, но мышление всегда «как в Claude Code».
  const thinking: ClaudeThinking = "auto";
  const effort = patch.effort === undefined ? (model.supportedEffortLevels?.includes(old.effort!) ? old.effort : null) : patch.effort;
  if (effort !== null && (typeof effort !== "string" || !model.supportedEffortLevels?.includes(effort as EffortLevel))) throw Error("Этот уровень недоступен для выбранной модели Claude");
  const orchestration = patch.orchestration === undefined ? old.orchestration : patch.orchestration === true;
  const value: ClaudePreferences = { model: model.value, effort: effort as EffortLevel | null, thinking, orchestration };
  preferences[String(uid)] = value;
  const temp = file + ".tmp";
  writeFileSync(temp, JSON.stringify(preferences) + "\n", { mode: 0o600 });
  chmodSync(temp, 0o600); renameSync(temp, file);
  return value;
}
/** Ultracode требует модель с уровнем xhigh: без него Claude Code тихо его не включит. */
export function claudeOrchestrationAvailable(uid: number): boolean {
  const value = claudePreferences(uid);
  return claudeModels(uid).find(m => m.value === value.model)?.supportedEffortLevels?.includes("xhigh") ?? false;
}
export function claudeRuntimeOptions(uid: number): Pick<Options, "model" | "effort" | "thinking" | "settings"> {
  const value = claudePreferences(uid), model = claudeModels(uid).find(m => m.value === value.model);
  return {
    // Субагенты по умолчанию держат кэш 5 минут: после паузы весь их контекст пишется
    // в кэш заново (запись ~12× дороже чтения). Час — как у основного диалога.
    // Ultracode — флаг сессии, а не effort: глубина остаётся как есть (при «Авто» Claude Code берёт xhigh).
    settings: { subagentPromptCacheTtl: "1h", ...(value.orchestration && claudeOrchestrationAvailable(uid) ? { ultracode: true } : {}) },
    ...(value.model !== "default" ? { model: value.model } : {}),
    ...(value.effort && value.thinking !== "disabled" ? { effort: value.effort } : {}),
    ...(value.thinking === "disabled" ? { thinking: { type: "disabled" as const } } : value.thinking === "enabled" ? { thinking: model?.supportsAdaptiveThinking ? { type: "adaptive" as const } : { type: "enabled" as const } } : {}),
  };
}
export function claudeState(uid: number) {
  let available = !!credentialFor(uid);
  try { workerFor(uid); } catch { available = false; }
  return { available, ...claudePreferences(uid), orchestrationAvailable: claudeOrchestrationAvailable(uid), models: claudeModels(uid), version: CLAUDE_CODE_VERSION };
}

export function claudeModelLabel(model: ModelInfo): string {
  const name = model.description.split(" · ")[0] || model.displayName;
  return model.value === "default" ? `По умолчанию · ${name}` : name;
}
export const CLAUDE_EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Низкий · Low", medium: "Средний · Medium", high: "Высокий · High", xhigh: "Очень высокий · XHigh", max: "Максимальный · Max",
};
