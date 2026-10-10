import { test } from "node:test";
import assert from "node:assert/strict";
import { priceUsage, quotaPeriods } from "./quota-rates.mjs";
test("cache is a subset of input; rates differ by model and fractional points are exact", () => {
  const u = { input_tokens: 1000255, cached_input_tokens: 887552, output_tokens: 13245 };
  assert.equal(priceUsage("gpt-6-sol", u).units, 267683.2);
  assert.equal(priceUsage("gpt-6-astra", u).units, 1338416);
  assert.equal(priceUsage("gpt-6-luna", u).units, 13384.16);
  assert.equal(priceUsage("gpt-6-luna", { input_tokens: 1, cached_input_tokens: 1 }).ticks, 1);
  // Незнакомая модель (новая из каталога Codex) считается по самой дорогой линейке, а не ломает учёт.
  assert.equal(priceUsage("unknown", u).ticks, priceUsage("gpt-6-astra", u).ticks);
  assert.throws(() => priceUsage("gpt-6-sol", { input_tokens: 1, cached_input_tokens: 2 }));
});
test("quota periods reset at UTC midnight and Monday, including Sunday and year rollover", () => {
  const a = quotaPeriods(Date.parse("2026-10-04T23:59:59Z"));
  assert.equal(new Date(a.week).toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(new Date(a.weekReset).toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(
    new Date(quotaPeriods(Date.parse("2027-01-01")).week).toISOString(),
    "2026-12-28T00:00:00.000Z",
  );
});

test("personal week follows the confirmed OpenAI reset, not calendar Monday", () => {
  const reset = 1791580519000;
  const p = quotaPeriods(Date.parse("2026-10-03T00:00:00Z"), reset);
  assert.equal(p.weekReset, reset);
  assert.equal(p.week, reset - 7 * 86400000);
  assert.equal(quotaPeriods(reset, reset).weekReset, reset + 7 * 86400000);
});
