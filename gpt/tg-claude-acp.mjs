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
    const response = await call(`${sessionId}/turn`, { text }, abort.signal);
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
      return { sessionId: (await response.json()).sessionId };
    }
    case "session/load": {
      const response = await call(`${params.sessionId}/check`);
      if (!(await response.json()).ok) throw new Error("Диалог не найден в боте");
      return null; // история уже в bb — повторять её не нужно
    }
    case "session/prompt":
      return prompt(params.sessionId, params.prompt);
    case "session/cancel": {
      running.get(params.sessionId)?.abort();
      await call(`${params.sessionId}/cancel`).catch(() => undefined);
      return null;
    }
    case "session/set_mode":
    case "session/set_model":
    case "session/set_config_option":
      return {};
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
