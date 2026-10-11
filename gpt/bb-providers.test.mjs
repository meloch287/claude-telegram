// Лишние провайдеры bb (Pi, Cursor…) выключаются при каждой настройке окружения, а не только у старых пользователей.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("bootstrap bb выключает провайдеров без наших аккаунтов", () => {
  const src = readFileSync(new URL("./web-runtime.mjs", import.meta.url), "utf8");
  const list = JSON.parse(/export const UNUSED_PROVIDERS = (\[[^\]]*\]);/.exec(src)[1]);
  for (const id of ["pi", "acp-cursor", "acp-opencode", "acp-omp", "acp-grok", "acp-hermes-agent"]) assert.ok(list.includes(id), id);
  assert.ok(!list.includes("codex") && !list.includes("acp-tgclaude"), "GPT и Claude бота не трогаем");
  const bootstrap = src.slice(src.indexOf("async function bootstrap"), src.indexOf("async function boot("));
  assert.match(bootstrap, /bb provider disable "\$p"[^`]*UNUSED_PROVIDERS|UNUSED_PROVIDERS[^`]*bb provider disable/, "выключение — в bootstrap");
  assert.ok(bootstrap.indexOf("UNUSED_PROVIDERS") < bootstrap.indexOf("if (!marked)"), "не только при первой настройке");
});
