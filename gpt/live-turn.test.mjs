import { setImmediate } from "node:timers";
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createLiveTurn, attachLiveInput, steerJob } from "./live-turn.mjs";
const tick = () => new Promise((r) => setImmediate(r));
function fixture({ delayStart = false } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  const requests = [];
  let start;
  const reply = (m, result) => proc.stdout.write(JSON.stringify({ id: m.id, result }) + "\n");
  const notify = (method, params) => proc.stdout.write(JSON.stringify({ method, params }) + "\n");
  proc.stdin = new Writable({
    write(data, _, done) {
      const m = JSON.parse(data);
      requests.push(m);
      if (m.id) {
        if (m.method === "initialize") reply(m, {});
        if (m.method.startsWith("thread/")) reply(m, { thread: { id: "thread-1" } });
        if (m.method === "turn/start") {
          start = () => reply(m, { turn: { id: "turn-1", status: "inProgress" } });
          if (!delayStart) start();
        }
        if (m.method === "turn/steer") reply(m, { turnId: "turn-1" });
      }
      done();
    },
    final(done) {
      proc.exitCode = 0;
      proc.stdout.end();
      proc.emit("close", 0);
      done();
    },
  });
  proc.kill = () => {
    proc.exitCode = 1;
    proc.stdout.end();
    proc.emit("close", 1);
  };
  const live = createLiveTurn(proc, {
    model: "gpt-6-sol",
    effort: "medium",
    cwd: "/own",
    prompt: "first",
  });
  const events = [];
  live.stdout.on("data", (b) => events.push(...b.toString().trim().split("\n").map(JSON.parse)));
  return { proc, live, requests, events, notify, start: () => start() };
}
test("steers the same active turn and preserves tool events and total usage", async () => {
  const f = fixture();
  await f.live.ready;
  assert.equal(await f.live.steer("also second"), true);
  assert.deepEqual(f.requests.find((m) => m.method === "turn/steer").params, {
    threadId: "thread-1",
    expectedTurnId: "turn-1",
    input: [{ type: "text", text: "also second", text_elements: [] }],
  });
  f.notify("item/completed", {
    threadId: "thread-1",
    turnId: "turn-1",
    item: {
      id: "cmd1",
      type: "commandExecution",
      command: "pwd",
      aggregatedOutput: "/own",
      exitCode: 0,
      status: "completed",
    },
  });
  f.notify("thread/tokenUsage/updated", {
    threadId: "thread-1",
    turnId: "turn-1",
    tokenUsage: { total: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 4 } },
  });
  f.notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
  await tick();
  assert.equal(f.events.find((e) => e.item?.id === "cmd1").item.exit_code, 0);
  assert.deepEqual(f.events.find((e) => e.type === "turn.completed").usage, {
    input_tokens: 100,
    cached_input_tokens: 80,
    output_tokens: 4,
  });
  assert.equal(await f.live.steer("late"), false);
});
test("input arriving during startup reaches active turn", async () => {
  const f = fixture({ delayStart: true });
  const result = f.live.steer("during startup");
  await tick();
  f.start();
  assert.equal(await result, true);
  f.notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
});
test("cross-dialog and cancelled messages never reach running task", async () => {
  const job = { uid: 1, threadId: 2 };
  const input = attachLiveInput(job);
  let calls = 0;
  input.resolve({
    steer: async () => {
      calls++;
      return true;
    },
  });
  assert.equal(await steerJob(job, 1, 3, "wrong dialog"), false);
  assert.equal(await steerJob(job, 9, 2, "wrong user"), false);
  job.cancelled = true;
  assert.equal(await steerJob(job, 1, 2, "stopped"), false);
  assert.equal(calls, 0);
});
test("startup failure unblocks later messages without losing them", async () => {
  const job = { uid: 1, threadId: 2 };
  const input = attachLiveInput(job);
  const result = steerJob(job, 1, 2, "follow-up");
  input.resolve(null);
  assert.equal(await result, false);
});
test("completion before steer acknowledgement still reports accepted exactly once", async () => {
  const f = fixture();
  await f.live.ready;
  const write = f.proc.stdin._write;
  let pending;
  f.proc.stdin._write = (data, enc, done) => {
    const m = JSON.parse(data);
    if (m.method === "turn/steer") {
      pending = m;
      done();
    } else write(data, enc, done);
  };
  const result = f.live.steer("last second");
  await tick();
  f.notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
  f.proc.stdout.write(JSON.stringify({ id: pending.id, result: { turnId: "turn-1" } }) + "\n");
  assert.equal(await result, true);
  await tick();
  assert.equal(f.live.exitCode, 0);
});
test("known completion race returns false, transport errors do not replay", async () => {
  const f = fixture();
  await f.live.ready;
  f.proc.stdin._write = (data, enc, done) => {
    const m = JSON.parse(data);
    f.proc.stdout.write(
      JSON.stringify({ id: m.id, error: { message: "no active turn to steer", code: -32600 } }) +
        "\n",
    );
    done();
  };
  assert.equal(await f.live.steer("late"), false);
  f.proc.kill();
  await tick();
});

test("ambiguous disconnect does not claim acceptance or replay a message", async () => {
  const f = fixture();
  await f.live.ready;
  f.proc.stdin._write = (_data, _enc, done) => done();
  const result = f.live.steer("possibly delivered");
  await tick();
  f.proc.kill();
  await assert.rejects(result, /connection closed/);
});
test("missing usage is not replaced by a zero cumulative snapshot", async () => {
  const f = fixture();
  await f.live.ready;
  f.notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
  await tick();
  assert.equal("usage" in f.events.find((e) => e.type === "turn.completed"), false);
});
