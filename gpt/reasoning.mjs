// Confirmed against the installed Codex model catalog (0.159.3).
export const EFFORTS = Object.freeze([
  ["low", "⚡ Low — быстро"],
  ["medium", "⚖️ Medium — баланс"],
  ["high", "🧠 High — глубже"],
  ["xhigh", "🔬 XHigh — очень глубоко"],
  ["max", "🏔 Max — максимум"],
  ["ultra", "🚀 Ultra — предельный"],
]);
// Уровни из каталога Codex (gpt-models.mjs) главнее встроенного правила.
const liveEfforts = new Map();
export function setModelEfforts(entries) {
  liveEfforts.clear();
  for (const [model, levels] of entries) if (Array.isArray(levels) && levels.length) liveEfforts.set(model, new Set(levels));
}
export function effortsFor(model) {
  const live = liveEfforts.get(model);
  if (live) {
    const known = EFFORTS.filter(([id]) => live.has(id));
    if (known.length) return known;
  }
  return model === "gpt-6-luna" ? EFFORTS.slice(0, 5) : EFFORTS;
}
export function effortId(value, model) {
  if (!effortsFor(model).some(([id]) => id === value))
    throw new Error("Этот effort недоступен для выбранной модели");
  return value;
}
export function effectiveEffort(value, model) {
  return effortsFor(model).some(([id]) => id === value) ? value : "medium";
}
