// Юнит-проверки чистой логики bb-engine.js: node --test engine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
await import("./bb-engine.js");
const T = globalThis.__bbEngine._test;
const user = (text) => ({ kind: "conversation", role: "user", text, initiator: "user" });
const said = (text) => ({ kind: "conversation", role: "assistant", text });
const FIXTURES = {
  native: {
    thread: { id: "thr_native", providerId: "codex", title: null, titleFallback: "Дарова" },
    timeline: { rows: [
      user("Дарова"), said("Дарова! Чем займёмся?"),
      user("Покажи мне данные моей папки всю структуру что ты видишь"),
      { kind: "turn", children: [said("Посмотрю структуру"), { kind: "work", workKind: "command", command: "ls" }, { kind: "work", workKind: "file-change", change: { path: "/w/a.txt", movePath: null } }] },
      said("Вижу вашу папку: a.txt"),
    ], timelinePage: { hasOlderRows: false } },
  },
  synced: {
    thread: { id: "thr_tgsynced", providerId: "codex", title: "bb — разработка" },
    timeline: { rows: Array.from({ length: 30 }, (_, i) => [user(`запрос ${i} ` + "подробности ".repeat(40)), said(`ответ ${i} ` + "итог ".repeat(120))]).flat(), timelinePage: { hasOlderRows: true } },
  },
};
const fx = (name) => FIXTURES[name];

test("engineOf", () => {
  assert.equal(T.engineOf("claude-code"), "claude");
  assert.equal(T.engineOf("codex"), "gpt");
  assert.equal(T.engineOf("pi"), null);
});

test("threadsOf keeps children with their root and unknown providers in both", () => {
  const threads = [
    { id: "a", providerId: "codex", parentThreadId: null },
    { id: "b", providerId: "claude-code", parentThreadId: null },
    { id: "c", providerId: "claude-code", parentThreadId: "a" }, // Claude-потомок GPT-ветки
    { id: "d", providerId: "pi", parentThreadId: null },
    { id: "e", providerId: "codex", parentThreadId: "missing" },
  ];
  assert.deepEqual(T.threadsOf(threads, "gpt").map((t) => t.id), ["a", "c", "d", "e"]);
  assert.deepEqual(T.threadsOf(threads, "claude").map((t) => t.id), ["b", "d"]);
  const same = [{ id: "x", providerId: "codex" }];
  assert.equal(T.threadsOf(same, "gpt"), same, "без изменений — тот же массив");
});

test("digest of native thread includes request, final answer and stays in budget", () => {
  const { thread, timeline } = fx("native");
  const text = T.buildDigest(thread, timeline, 12000);
  assert.ok(text.startsWith("[Справка о другом диалоге"));
  assert.ok(text.includes(`@thread:${thread.id}`));
  assert.ok(text.includes("Запрос: Покажи мне данные моей папки"));
  assert.ok(text.includes("Итог GPT: Вижу вашу папку"));
  assert.ok(text.includes("Файлы: /w/a.txt"));
  assert.ok(text.includes(`bb thread log ${thread.id}`));
  assert.ok(text.length <= 12500, String(text.length));
});

test("digest of long synced thread respects small budget and marks omission", () => {
  const { thread, timeline } = fx("synced");
  const text = T.buildDigest(thread, timeline, 3000);
  assert.ok(text.length <= 3600, String(text.length));
  assert.ok(text.includes("Более ранние обмены не показаны"));
  const segments = T.segmentsOf(timeline.rows);
  const last = segments[segments.length - 1];
  assert.ok(text.includes(last.user.trim().slice(0, 40).replace(/\s+/g, " ").slice(0, 20)) || text.includes(last.user.slice(0, 20)));
});

test("withThreadContext appends agent-only digest for mentioned threads only", async () => {
  const body = JSON.stringify({
    providerId: "codex",
    input: [{ type: "text", text: "Продолжи диалог @thread:thr_a\n\nпривет", mentions: [{ start: 16, end: 29, resource: { kind: "thread", threadId: "thr_a", label: "A" } }] }],
  });
  const calls = [];
  const out = await T.withThreadContext(body, null, async (id, budget) => (calls.push([id, budget]), `[Справка о другом диалоге] ${id}`));
  const parsed = JSON.parse(out);
  assert.deepEqual(calls, [["thr_a", 12000]]);
  assert.equal(parsed.input.length, 2);
  assert.deepEqual(parsed.input[1], { type: "text", text: "[Справка о другом диалоге] thr_a", mentions: [], visibility: "agent-only" });
  assert.equal(parsed.providerId, "codex");
  // повторная отправка того же тела не дублирует справку
  assert.equal(await T.withThreadContext(out, null, async () => "x"), out);
  // упоминание текущего диалога и отсутствие упоминаний — без изменений
  const self = JSON.stringify({ input: [{ type: "text", text: "@thread:thr_me", mentions: [{ start: 0, end: 14, resource: { kind: "thread", threadId: "thr_me", label: "me" } }] }] });
  assert.equal(await T.withThreadContext(self, "thr_me", async () => "x"), self);
  const plain = JSON.stringify({ input: [{ type: "text", text: "просто текст", mentions: [] }] });
  assert.equal(await T.withThreadContext(plain, null, async () => "x"), plain);
  // ошибка сборки сводки — сообщение уходит как было
  assert.equal(await T.withThreadContext(body, null, async () => { throw new Error("boom"); }), body);
  // не JSON — без изменений
  assert.equal(await T.withThreadContext("{oops", null, async () => "x"), "{oops");
});

test("two mentions share the budget, max two", async () => {
  const mention = (id, at) => ({ start: at, end: at + 5, resource: { kind: "thread", threadId: id, label: id } });
  const body = JSON.stringify({ input: [{ type: "text", text: "a b c", mentions: [mention("t1", 0), mention("t2", 0), mention("t3", 0)] }] });
  const calls = [];
  await T.withThreadContext(body, null, async (id, budget) => (calls.push([id, budget]), "[Справка о другом диалоге] " + id));
  assert.deepEqual(calls, [["t1", 7000], ["t2", 7000]]);
});
