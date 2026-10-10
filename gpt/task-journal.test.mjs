import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskJournal, finishTaskMessage } from "./task-journal.mjs";
test("journal uses actual completed commands, files and errors without duplicate event steps", () => {
  const j = new TaskJournal();
  j.observe({
    type: "item.started",
    item: { id: "a", type: "command_execution", command: "npm test", status: "in_progress" },
  });
  j.observe({
    type: "item.completed",
    item: {
      id: "a",
      type: "command_execution",
      command: "npm test",
      status: "completed",
      exit_code: 0,
      aggregated_output: "5 tests passed",
    },
  });
  j.observe({
    type: "item.completed",
    item: {
      id: "b",
      type: "file_change",
      status: "completed",
      changes: [{ path: "src/app.ts", kind: "update" }],
    },
  });
  j.observe({
    type: "item.completed",
    item: {
      id: "c",
      type: "command_execution",
      command: "npm run check",
      status: "completed",
      exit_code: 1,
      aggregated_output: "Type error",
    },
  });
  j.observe({
    type: "item.started",
    item: { id: "d", type: "web_search", query: "documentation" },
  });
  const text = j.render({ success: true, cancelled: false, durationMs: 65000, tokens: 12345 });
  assert.match(text, /✅ Готово/);
  assert.match(text, /1 мин 5 с/);
  assert.match(text, /Шаги \(4\)/);
  assert.match(text, /- \[x\] 🖥️ `npm test`/);
  assert.match(text, /- \[ \] ⚠️ 🖥️ `npm run check`/);
  assert.match(text, /src\/app.ts/);
  assert.match(text, /5 tests passed/);
  assert.match(text, /Ошибки инструментов/);
  assert.match(text, /⏸ 🌐/);
  assert.equal((text.match(/\[x\] 🖥️ `npm test`/g) || []).length, 1);
});
test("journal masks secrets, bounds output, skips prose and does not claim success on cancellation", () => {
  const j = new TaskJournal();
  j.observe({
    type: "item.completed",
    item: { id: "answer", type: "agent_message", text: "Private answer" },
  });
  assert.doesNotMatch(j.render({ success: true, durationMs: 0, tokens: 0 }), /Шаги|Private/);
  for (let i = 0; i < 100; i++)
    j.observe({
      type: "item.completed",
      item: {
        id: String(i),
        type: "command_execution",
        command: "echo token=secret_value_123456",
        exit_code: 0,
        status: "completed",
        aggregated_output: "password=very_secret_value\n" + "x".repeat(5000),
      },
    });
  const text = j.render({ success: true, cancelled: true, durationMs: 1000, tokens: 0 });
  assert.match(text, /⏹ Остановлено/);
  assert.doesNotMatch(text, /✅ Готово|secret_value_123456|very_secret_value/);
  assert.ok(text.length < 24000);
});
test("completion appears after answer and removes the old progress message only after delivery", async () => {
  const events = [];
  const api = {
    raw: {
      sendRichMessage: async (data) => {
        events.push(["send", data]);
        return { message_id: 50 };
      },
    },
    deleteMessage: async (...args) => events.push(["delete", args]),
  };
  await finishTaskMessage(api, 101, 9, "✅ Готово");
  assert.deepEqual(
    events.map((e) => e[0]),
    ["send", "delete"],
  );
  events.length = 0;
  api.raw.sendRichMessage = async () => {
    throw new Error("network");
  };
  await assert.rejects(finishTaskMessage(api, 101, 9, "✅ Готово"), /network/);
  assert.deepEqual(events, []);
});

test("long multiline logs remain in one message with balanced collapsible blocks", async () => {
  const j = new TaskJournal();
  for (let i = 0; i < 40; i++)
    j.observe({
      type: "item.completed",
      item: {
        id: String(i),
        type: "command_execution",
        command: "npm test",
        status: "completed",
        exit_code: i % 2,
        aggregated_output: Array.from({ length: 500 }, (_, n) => "line " + n).join("\n"),
      },
    });
  const messages = [];
  await finishTaskMessage(
    {
      raw: {
        sendRichMessage: async (body) => {
          messages.push(body.rich_message.markdown);
          return { message_id: 1 };
        },
      },
      deleteMessage: async () => {},
    },
    101,
    9,
    j.render({ success: true, durationMs: 1000, tokens: 50 }),
  );
  assert.equal(messages.length, 1);
  assert.equal(
    (messages[0].match(/<details>/g) || []).length,
    (messages[0].match(/<\/details>/g) || []).length,
  );
  assert.match(messages[0], /line 499/);
});
