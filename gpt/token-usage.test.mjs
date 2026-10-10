import { test } from "node:test";
import assert from "node:assert/strict";
import { usageDelta } from "./token-usage.mjs";
test("resumed task subtracts previous dialog usage: screenshot 68676 is really 42148", () => {
  const delta = usageDelta(
    { input_tokens: 67908, cached_input_tokens: 52096, output_tokens: 768 },
    { input_tokens: 26216, cached_input_tokens: 16640, output_tokens: 312 },
  );
  assert.deepEqual(delta, { input_tokens: 41692, cached_input_tokens: 35456, output_tokens: 456 });
  assert.equal(delta.input_tokens + delta.output_tokens, 42148);
  assert.equal(delta.input_tokens - delta.cached_input_tokens + delta.output_tokens, 6692);
});
test("first turn, repeated usage event and invalid/reset counters", () => {
  const u = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 };
  assert.deepEqual(usageDelta(u, {}), u);
  assert.deepEqual(usageDelta(u, u), { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 });
  assert.throws(() => usageDelta({}, u));
  assert.throws(() => usageDelta({ input_tokens: NaN }, {}));
});
