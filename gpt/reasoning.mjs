// Confirmed against the installed Codex model catalog (0.159.3).
export const EFFORTS = Object.freeze([
  ["low", "⚡ Low — быстро"],
  ["medium", "⚖️ Medium — баланс"],
  ["high", "🧠 High — глубже"],
  ["xhigh", "🔬 XHigh — очень глубоко"],
  ["max", "🏔 Max — максимум"],
  ["ultra", "🚀 Ultra — предельный"],
]);
export function effortsFor(model) {
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
