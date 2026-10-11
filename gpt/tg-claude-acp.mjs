#!/usr/bin/env node
// Агент ACP для рабочей зоны bb: «Claude» = Claude Telegram-бота.
//
// bb запускает его как свой провайдер (настройка Custom agents плагина ACP) и
// говорит с ним JSON-RPC по stdin/stdout. Сам агент ничего не думает: каждый ход
// уходит в бота (шлюз 172.30.0.1:8790/claude-bb → ai-bot), где его ведёт тот же
// движок, что и в Telegram. Поэтому диалог один и тот же в обоих местах.
// Сессия ACP = Claude-диалог бота (его id).
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const config = JSON.parse(readFileSync(process.env.TG_CLAUDE_CONFIG, "utf8"));
const base = String(config.url).replace(/\/team$/, "/claude-bb");
const headers = { authorization: `Bearer ${config.token}`, "content-type": "application/json" };
const running = new Map(); // sessionId → AbortController
// Модель и глубина — у каждой сессии свои и уходят в бота только с настоящим ходом:
// bb, чтобы узнать модели, создаёт пробную сессию и перебирает их, — бот это не трогает.
const chosen = new Map(); // sessionId → { model, effort }
let catalog = null; // { models: [{ value, name, efforts }], model, effort } из бота
const EFFORT_NAMES = { low: "Низкая", medium: "Средняя", high: "Высокая", xhigh: "Очень высокая" };

async function loadCatalog() {
  try {
    catalog = await (await call("settings")).json();
  } catch {
    catalog = catalog ?? null; // мост недоступен — работаем без списка моделей
  }
  return catalog;
}

/** Модели и глубина бота в формате ACP: bb показывает их в меню модели. */
function configState(sessionId) {
  if (!catalog?.models?.length) return {};
  const sel = chosen.get(sessionId) ?? { model: catalog.model, effort: catalog.effort };
  const model = catalog.models.find((m) => m.value === sel.model) ?? catalog.models[0];
  const effort = model.efforts.includes(sel.effort) ? sel.effort : "auto";
  return {
    configOptions: [
      { id: "model", name: "Модель", category: "model", type: "select", currentValue: model.value, options: catalog.models.map((m) => ({ value: m.value, name: m.name })) },
      { id: "effort", name: "Глубина", category: "thought_level", type: "select", currentValue: effort, options: [{ value: "auto", name: "Авто" }, ...model.efforts.map((v) => ({ value: v, name: EFFORT_NAMES[v] ?? v }))] },
    ],
    models: { currentModelId: model.value, availableModels: catalog.models.map((m) => ({ modelId: m.value, name: m.name })) },
  };
}

function choose(sessionId, patch) {
  const sel = chosen.get(sessionId) ?? { model: catalog?.model, effort: catalog?.effort ?? null };
  // Неизвестную модель (старая настройка ветки) не отвергаем — остаёмся на текущей.
  if (patch.model !== undefined && (!catalog || catalog.models.some((m) => m.value === patch.model))) sel.model = patch.model;
  if (patch.effort !== undefined) sel.effort = patch.effort === "auto" ? null : patch.effort;
  chosen.set(sessionId, sel);
  return configState(sessionId);
}

const out = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const update = (sessionId, value) => out({ method: "session/update", params: { sessionId, update: value } });
const say = (sessionId, text) => update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });

async function call(path, body = {}, signal) {
  const response = await fetch(`${base}/${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Object.assign(new Error(detail.error || `Мост Claude ответил ${response.status}`), { status: response.status });
  }
  return response;
}

function promptText(blocks) {
  const parts = [];
  for (const block of blocks ?? []) {
    if (block?.type === "text" && block.text) parts.push(block.text);
    else if (block?.type === "resource" && block.resource?.text) parts.push(`Вложение ${block.resource.uri ?? ""}:\n${block.resource.text}`);
    else if (block?.type === "resource_link" && block.uri) parts.push(`Файл: ${block.uri}`);
  }
  return parts.join("\n\n").trim();
}

async function prompt(sessionId, blocks) {
  const text = promptText(blocks);
  if (!text) return { stopReason: "end_turn" };
  const abort = new AbortController();
  running.set(sessionId, abort);
  const seen = new Set();
  let step = 0;
  let wrote = false;
  try {
    const sel = chosen.get(sessionId);
    const response = await call(`${sessionId}/turn`, { text, ...(sel ? { model: sel.model, effort: sel.effort } : {}) }, abort.signal);
    const decoder = new TextDecoder();
    let buffer = "";
    let stopReason = "end_turn";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "text") {
          say(sessionId, (wrote ? "\n\n" : "") + event.text);
          wrote = true;
        } else if (event.type === "note") {
          say(sessionId, (wrote ? "\n\n" : "") + `_${event.text}_`);
          wrote = true;
        } else if (event.type === "status") {
          // Строка хода работы: заголовок, пустая строка, последние шаги. Каждый новый шаг — один раз.
          const steps = event.text.split("\n\n").slice(1).join("\n").split("\n").map((s) => s.trim()).filter(Boolean);
          for (const title of steps) {
            if (seen.has(title)) continue;
            seen.add(title);
            update(sessionId, { sessionUpdate: "tool_call", toolCallId: `step-${++step}`, title, kind: "other", status: "completed" });
          }
        } else if (event.type === "context") {
          update(sessionId, { sessionUpdate: "usage_update", used: event.used, size: event.size });
        } else if (event.type === "done") {
          stopReason = event.stopReason || "end_turn";
        }
      }
    }
    return { stopReason };
  } catch (error) {
    if (abort.signal.aborted) return { stopReason: "cancelled" };
    say(sessionId, (wrote ? "\n\n" : "") + `⚠️ ${error.message}`);
    return { stopReason: "end_turn" };
  } finally {
    running.delete(sessionId);
  }
}

async function handle(message) {
  const { method, params = {} } = message;
  switch (method) {
    case "initialize":
      return { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: false, embeddedContext: true } }, authMethods: [] };
    case "authenticate":
      return {};
    case "session/new": {
      const response = await call("new");
      const { sessionId } = await response.json();
      await loadCatalog();
      return { sessionId, ...configState(sessionId) };
    }
    case "session/load": {
      const response = await call(`${params.sessionId}/check`);
      const found = await response.json();
      if (!found.ok) throw new Error("Диалог не найден в боте");
      // bb применит это после загрузки — индикатор контекста сразу свежий.
      if (found.context) update(params.sessionId, { sessionUpdate: "usage_update", used: found.context.used, size: found.context.size });
      await loadCatalog();
      return configState(params.sessionId); // история уже в bb — повторять её не нужно
    }
    case "session/prompt":
      return prompt(params.sessionId, params.prompt);
    case "session/cancel": {
      running.get(params.sessionId)?.abort();
      await call(`${params.sessionId}/cancel`).catch(() => undefined);
      return null;
    }
    case "session/set_mode":
      return {};
    case "session/set_model":
      return choose(params.sessionId, { model: params.modelId });
    case "session/set_config_option":
      if (params.configId === "model") return choose(params.sessionId, { model: params.value });
      if (params.configId === "effort") return choose(params.sessionId, { effort: params.value });
      return configState(params.sessionId);
    default:
      throw Object.assign(new Error(`Метод ${method} не поддерживается`), { code: -32601 });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!message.method) return; // ответы клиента нам не нужны
  handle(message).then(
    (result) => { if (message.id !== undefined) out({ id: message.id, result: result ?? null }); },
    (error) => { if (message.id !== undefined) out({ id: message.id, error: { code: error.code ?? -32000, message: error.message } }); },
  );
});
