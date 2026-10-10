import { turnInput } from "./attachment-input.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";

export function attachLiveInput(job) {
  let resolve;
  const ready = new Promise((r) => {
    resolve = r;
  });
  job.liveInput = { ready, resolve };
  return job.liveInput;
}
export async function steerJob(job, uid, threadId, prompt, images=[]) {
  if (!job || job.uid !== uid || job.threadId !== threadId || job.cancelled || !job.liveInput)
    return false;
  const live = await job.liveInput.ready;
  if (!live || job.cancelled) return false;
  return live.steer(prompt, images);
}

function itemEvent(method, item) {
  const types = {
    agentMessage: "agent_message",
    commandExecution: "command_execution",
    fileChange: "file_change",
    webSearch: "web_search",
    mcpToolCall: "mcp_tool_call",
    dynamicToolCall: "mcp_tool_call",
  };
  return {
    type: method.replace("/", "."),
    item: {
      ...item,
      type: types[item.type] || item.type,
      ...(item.aggregatedOutput !== undefined ? { aggregated_output: item.aggregatedOutput } : {}),
      ...(item.exitCode !== undefined ? { exit_code: item.exitCode } : {}),
    },
  };
}
// App-server is scoped to ONE Telegram job, in the same per-dialog home as exec.
// Adapt its public events to the existing journal and cumulative usage accounting.
export function createLiveTurn(
  proc,
  { model, effort, cwd, thread, prompt, images=[], rpcTimeoutMs = 60_000 },
) {
  const live = new EventEmitter();
  live.on("error", () => {});
  live.stdout = new PassThrough();
  live.stderr = proc.stderr;
  live.exitCode = null;
  let seq = 0,
    threadId,
    turnId,
    ended = false,
    closing = false,
    steers = 0,
    terminal = false,
    failed = false,
    usage;
  const pending = new Map();
  const emit = (event) => {
    if (!live.stdout.writableEnded) live.stdout.write(JSON.stringify(event) + "\n");
  };
  function send(message) {
    proc.stdin.write(JSON.stringify(message) + "\n");
  }
  function rpc(method, params) {
    if (ended || closing) return Promise.reject(Error("Codex connection closed"));
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`Codex request timed out: ${method}`));
      }, rpcTimeoutMs);
      timer.unref();
      pending.set(id, { resolve, reject, timer });
      try {
        send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }
  let killTimer;
  function finish() {
    if (!terminal || steers || closing || ended) return;
    closing = true;
    proc.stdin.end();
    if (!ended) {
      killTimer = setTimeout(() => proc.kill("SIGTERM"), 5000);
      killTimer.unref();
    }
  }
  function fail(error) {
    failed = true;
    terminal = true;
    emit({ type: "turn.failed", error: { message: error.message } });
    finish();
  }
  live.cancel = () => {
    if (ended || closing) return;
    if (threadId && turnId) {
      try { send({id:++seq,method:'turn/interrupt',params:{threadId,turnId}}); } catch {}
    }
    fail(Error('Запрос остановлен'));
  };
  const lines = createInterface({ input: proc.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id !== undefined && !m.method) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(Object.assign(Error(m.error.message), { rpcCode: m.error.code }));
      else p.resolve(m.result);
      return;
    }
    // Never leave unsupported server requests pending forever.
    if (m.id !== undefined) {
      send({
        id: m.id,
        error: {
          code: -32601,
          message:
            "This Telegram client does not support interactive requests; use the configured noninteractive tools.",
        },
      });
      return;
    }
    const p = m.params || {};
    if (p.threadId && threadId && p.threadId !== threadId) return;
    if (m.method === "turn/started") turnId = p.turn.id;
    if (m.method === "thread/tokenUsage/updated") {
      const total = p.tokenUsage?.total;
      if (total)
        usage = {
          input_tokens: total.inputTokens,
          cached_input_tokens: total.cachedInputTokens,
          output_tokens: total.outputTokens,
        };
    }
    if (["item/started", "item/completed"].includes(m.method) && p.item)
      emit(itemEvent(m.method, p.item));
    if (m.method === "turn/plan/updated")
      emit({
        type: "item.updated",
        item: {
          type: "todo_list",
          items: (p.plan || []).map((s) => ({ text: s.step, completed: s.status === "completed" })),
        },
      });
    // Heartbeats include token/tool deltas so long commands don't look stalled.
    if (m.method?.startsWith("item/") && !["item/started", "item/completed"].includes(m.method))
      emit({ type: "activity" });
    if (m.method === "error" && !p.willRetry) emit({ type: "error", error: p.error });
    if (m.method === "turn/completed") {
      terminal = true;
      if (p.turn.status === "completed")
        emit({ type: "turn.completed", ...(usage ? { usage } : {}) });
      else {
        failed = true;
        emit({ type: "turn.failed", error: p.turn.error || { message: "Работа остановлена" } });
      }
      finish();
    }
  });
  proc.stdin.on("error", (error) => {
    if (!closing) fail(error);
  });
  proc.on("error", (error) => {
    fail(error);
    live.emit("error", error);
  });
  proc.on("close", (code) => {
    ended = true;
    clearTimeout(killTimer);
    lines.close();
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Codex connection closed"));
    }
    pending.clear();
    live.exitCode = failed ? 1 : code;
    live.stdout.end();
    live.emit("close", live.exitCode);
  });
  live.ready = (async () => {
    await rpc("initialize", {
      clientInfo: { name: "gpt_telegram", title: "GPT Telegram", version: "1.0" },
      capabilities: { experimentalApi: true },
    });
    send({ method: "initialized", params: {} });
    const params = {
      model,
      cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      config: { model_reasoning_effort: effort },
    };
    const result = await rpc(
      thread ? "thread/resume" : "thread/start",
      thread ? { ...params, threadId: thread, excludeTurns: true } : params,
    );
    threadId = result.thread.id;
    emit({ type: "thread.started", thread_id: threadId });
    const started = await rpc("turn/start", {
      threadId,
      input: turnInput(prompt, images, cwd),
      model,
      effort,
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
    turnId = started.turn.id;
  })();
  live.ready.catch(fail);
  let steering = Promise.resolve();
  live.steer = (prompt, images=[]) => {
    const operation = steering.then(async () => {
      try {
        await live.ready;
      } catch {
        return false;
      }
      if (terminal || ended || closing) return false;
      steers++;
      try {
        await rpc("turn/steer", {
          threadId,
          expectedTurnId: turnId,
          input: turnInput(prompt, images, cwd),
        });
        return true;
      } catch (error) {
        // Only explicit server rejection guarantees that replay is safe.
        if (
          error.rpcCode !== undefined &&
          /no active turn|expected.*turn|turn.*mismatch/i.test(error.message)
        )
          return false;
        throw error;
      } finally {
        steers--;
        finish();
      }
    });
    steering = operation.catch(() => {});
    return operation;
  };
  return live;
}
