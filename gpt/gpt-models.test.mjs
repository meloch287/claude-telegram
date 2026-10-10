// Модели GPT из каталога Codex: новые появляются сами, служебные скрыты.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogFrom, labelFor, createGptModels } from "./gpt-models.mjs";
import { MODELS, modelId } from "./policy.mjs";
import { effortsFor } from "./reasoning.mjs";
import { ratesFor, QUOTA_RATES } from "./quota-rates.mjs";

const cache = { models: [
  { slug: "gpt-6-sol", display_name: "GPT-6-Sol", visibility: "list", supported_in_api: true, priority: 3, supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "ultra" }] },
  { slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", visibility: "list", supported_in_api: true, priority: 1, supported_reasoning_levels: [{ effort: "medium" }, { effort: "high" }] },
  { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", supported_in_api: true, priority: 4 },
  { slug: "codex-auto-review", visibility: "hide", priority: 43 },
] };

test("catalog keeps visible models by priority", () => {
  assert.deepEqual(catalogFrom(cache).models.map((m) => m.slug), ["gpt-6.1-sol", "gpt-6-sol"]);
  assert.equal(catalogFrom({ models: [] }), null);
  assert.equal(catalogFrom(null), null);
  assert.equal(labelFor({ slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol" }), "☀️ GPT 6.1 Sol");
});

test("refresh updates the shared model list in place and efforts", () => {
  const dir = mkdtempSync(join(tmpdir(), "gptm-"));
  const before = MODELS.map((m) => [...m]);
  try {
    const path = join(dir, "models_cache.json");
    writeFileSync(path, JSON.stringify(cache));
    const live = createGptModels({ path });
    assert.equal(live.refresh(), true);
    assert.deepEqual(MODELS.map(([id]) => id), ["gpt-6.1-sol", "gpt-6-sol"], "тот же массив, новые модели видны всем импортам");
    assert.equal(modelId("gpt-6.1-sol"), "gpt-6.1-sol");
    assert.deepEqual(effortsFor("gpt-6.1-sol").map(([id]) => id), ["medium", "high"]);
    assert.equal(JSON.parse(live.catalogJson()).models.length, 2);
    assert.equal(live.refresh(), false, "без изменений файла — не перечитываем");
    writeFileSync(path, "{испорчен");
    utimesSync(path, new Date(), new Date(Date.now() + 5000));
    assert.equal(live.refresh(), false, "испорченный кэш не трогает список");
    assert.deepEqual(MODELS.map(([id]) => id), ["gpt-6.1-sol", "gpt-6-sol"]);
  } finally {
    MODELS.splice(0, MODELS.length, ...before);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new models get quota rates of their line, unknown ones the most expensive", () => {
  assert.equal(ratesFor("gpt-6.1-sol"), QUOTA_RATES["gpt-6-sol"]);
  assert.equal(ratesFor("gpt-6.1-luna"), QUOTA_RATES["gpt-6-luna"]);
  assert.equal(ratesFor("gpt-7-nova"), QUOTA_RATES["gpt-6-astra"]);
});
