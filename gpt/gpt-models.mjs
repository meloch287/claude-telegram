// Каталог моделей GPT без ручных правок: Codex сам получает список моделей и кладёт
// его в ~/.codex/models_cache.json. Отсюда берём модели, видимые в выборе
// (visibility "list"), — новые появляются в боте, мини-аппе и bb автоматически.
// Нет кэша или он испорчен — остаётся прежний список.
import { readFileSync, statSync } from "node:fs";
import { ADMIN_ID } from "../dist/admin.js";
import { setModels } from "./policy.mjs";
import { setModelEfforts } from "./reasoning.mjs";

const OWNER_CACHE = `/opt/ai-bot/tenants/${ADMIN_ID}/home/.codex/models_cache.json`;
const MARKS = [[/sol\b/i, "☀️"], [/luna\b/i, "🌙"], [/astra\b/i, "✨"], [/terra\b/i, "🌍"], [/nova\b/i, "💫"]];

export function labelFor(model) {
  const name = String(model.display_name || model.slug).replaceAll("-", " ").replace(/^gpt\b/i, "GPT");
  const mark = MARKS.find(([re]) => re.test(model.slug))?.[1] ?? "🤖";
  return `${mark} ${name}`;
}

/** Видимые модели из кэша Codex, по приоритету; null — кэш непригоден. */
export function catalogFrom(raw) {
  const models = Array.isArray(raw?.models) ? raw.models : null;
  if (!models) return null;
  const visible = models
    .filter((m) => m && typeof m.slug === "string" && /^[a-z0-9][a-z0-9.\-]{1,60}$/.test(m.slug) && m.visibility === "list" && m.supported_in_api !== false)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  return visible.length ? { models: visible } : null;
}

export function createGptModels({ path = OWNER_CACHE, apply = setModels, applyEfforts = setModelEfforts } = {}) {
  let seen = 0;
  let catalog = null;
  function refresh() {
    let mtime;
    try { mtime = statSync(path).mtimeMs; } catch { return false; }
    if (mtime === seen) return false;
    seen = mtime;
    let next;
    try { next = catalogFrom(JSON.parse(readFileSync(path, "utf8"))); } catch { next = null; }
    if (!next) return false;
    catalog = next;
    apply(next.models.map((m) => [m.slug, labelFor(m)]));
    applyEfforts(next.models.map((m) => [m.slug, (m.supported_reasoning_levels || []).map((l) => l?.effort).filter(Boolean)]));
    return true;
  }
  return {
    refresh,
    /** Каталог для Codex в bb (model_catalog_json); null — оставить встроенный файл. */
    catalogJson: () => (catalog ? JSON.stringify(catalog) : null),
  };
}

export const gptModels = createGptModels();
