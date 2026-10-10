// Предупреждение на 80% личного лимита: один раз за неделю на движок, не до 80% и не после исчерпания.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createLimitWarnings, warningText } from "./limit-warnings.mjs";

test("80%: одно предупреждение на движок за неделю подписки", async () => {
  const db = new DatabaseSync(":memory:");
  const sent = [];
  const reset = Date.UTC(2026, 9, 14, 6);
  let shares = {
    1: { gpt: { used: 8.2, limit: 10, resetsAt: reset }, claude: { used: 3, limit: 10, resetsAt: reset } },
    2: { gpt: { used: 10, limit: 10, resetsAt: reset }, claude: { used: 5, limit: null } },
  };
  const check = createLimitWarnings({ db, users: () => [1, 2], shares: (uid) => shares[uid], send: async (uid, text) => sent.push([uid, text]) });
  assert.equal(await check(), 1);
  assert.equal(sent[0][0], 1);
  assert.match(sent[0][1], /GPT: потрачено 82%/);
  assert.match(sent[0][1], /8,2% из 10% подписки/);
  assert.match(sent[0][1], /14\.10, 09:00 МСК/);
  assert.equal(await check(), 0, "повторно не пишет");
  shares[1].claude.used = 9;
  assert.equal(await check(), 1, "Claude — отдельно");
  assert.match(sent.at(-1)[1], /^⚠️ Claude/);
  shares[1].gpt = { used: 8.5, limit: 10, resetsAt: reset + 7 * 86400000 };
  assert.equal(await check(), 1, "новая неделя — снова");
});

test("ошибка отправки не помечает предупреждение отправленным", async () => {
  const db = new DatabaseSync(":memory:");
  let fail = true, sent = 0;
  const check = createLimitWarnings({ db, users: () => [1], shares: () => ({ gpt: { used: 9, limit: 10, resetsAt: 1 } }), send: async () => { if (fail) throw new Error("offline"); sent++; } });
  assert.equal(await check(), 0);
  fail = false;
  assert.equal(await check(), 1);
  assert.equal(sent, 1);
  assert.match(warningText("claude", { used: 4, limit: 5, resetsAt: null }), /переключиться на GPT/);
});
