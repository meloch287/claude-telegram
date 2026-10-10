import { normalizeUsage } from "./token-usage.mjs";
// Internal points, normalized to one uncached GPT-6 Sol input token.
// Standard credit-rate ratios, NOT a conversion to included Pro allowance.
export const RATE_VERSION = "2026-10-03-standard-v1";
export const POINT_SCALE = 200;
export const QUOTA_RATES = Object.freeze({
  "gpt-6-sol": { input: 200, cached: 20, output: 1000 },
  "gpt-6-luna": { input: 10, cached: 1, output: 50 },
  "gpt-6-astra": { input: 1000, cached: 100, output: 5000 },
});
/**
 * Новые модели приходят из каталога Codex раньше, чем их коэффициенты: берём
 * коэффициенты той же линейки (sol/luna/astra), а незнакомую — по самой дорогой,
 * чтобы квота не занижалась.
 */
export function ratesFor(model) {
  if (QUOTA_RATES[model]) return QUOTA_RATES[model];
  const family = /luna/i.test(model) ? "gpt-6-luna" : /sol/i.test(model) ? "gpt-6-sol" : "gpt-6-astra";
  return QUOTA_RATES[family];
}
export function priceUsage(model, value) {
  const u = normalizeUsage(value),
    r = ratesFor(model);
  if (!r) throw new Error("Для модели не настроены коэффициенты квоты");
  const fresh = u.input_tokens - u.cached_input_tokens;
  const ticks = fresh * r.input + u.cached_input_tokens * r.cached + u.output_tokens * r.output;
  if (!Number.isSafeInteger(ticks)) throw new Error("Слишком большой расход квоты");
  return {
    ...u,
    fresh_input_tokens: fresh,
    ticks,
    units: ticks / POINT_SCALE,
    version: RATE_VERSION,
  };
}
export function quotaPeriods(now = Date.now(), resetAnchor = null) {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const week = new Date(day);
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
  if (Number.isSafeInteger(resetAnchor) && resetAnchor > 0) {
    const period = 7 * 86400000;
    const next = resetAnchor + (Math.floor((now - resetAnchor) / period) + 1) * period;
    return { day: +day, week: next - period, dayReset: +day + 86400000, weekReset: next };
  }
  return { day: +day, week: +week, dayReset: +day + 86400000, weekReset: +week + 7 * 86400000 };
}
