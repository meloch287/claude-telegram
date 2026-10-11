// Заполненность контекста из SDK: getContextUsage отдаёт camelCase, сообщения — snake_case.
import test from "node:test";
import assert from "node:assert/strict";
import { readContextUsage } from "../dist/agent/context-usage.js";

test("ответ getContextUsage (camelCase) — реальные токены, не «0 из 0»", () => {
  // форма SDKControlGetContextUsageResponse
  assert.deepEqual(readContextUsage({ categories: [], totalTokens: 120000, maxTokens: 980000, rawMaxTokens: 1000000, percentage: 12, gridRows: [] }), { percentage: 12, total: 120000, max: 1000000 });
});
test("context_usage в сообщении (snake_case) и мусор", () => {
  assert.deepEqual(readContextUsage({ model: "opus", total_tokens: 5000, raw_max_tokens: 200000, percentage: 3 }), { percentage: 3, total: 5000, max: 200000 });
  assert.equal(readContextUsage(null), null);
  assert.equal(readContextUsage({ totalTokens: 1 }), null);
});
