import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { sendFormatted, splitRichMarkdown } from "./rich-output.mjs";
test("agent answers use Telegram rich formatting with tables, headings, code and escaped prices", async () => {
  const calls = [];
  const api = {
    raw: {
      sendRichMessage: async (body) => {
        calls.push(body);
        return { message_id: 7 };
      },
    },
    sendMessage: async () => {},
  };
  const input =
    '# Итог\n\n**Готово**\n\n| Модель | Цена |\n|---|---|\n| Sol | $5 |\n\n```js\nconst price = "$5";\n```';
  await sendFormatted(api, 101, input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chat_id, 101);
  assert.match(calls[0].rich_message.markdown, /\| Модель \| Цена \|/);
  assert.ok(calls[0].rich_message.markdown.includes("\\$5"));
  assert.ok(calls[0].rich_message.markdown.includes('const price = "$5";'));
});
test("long code and tables keep valid boundaries, all rows, and bounded payloads", () => {
  const code =
    "```python\n" +
    Array.from({ length: 800 }, (_, i) => `print("ROW_${i} 🙂")`).join("\n") +
    "\n```";
  const pieces = splitRichMarkdown(code, 1200);
  assert.ok(pieces.length > 1);
  for (const p of pieces) {
    assert.ok(p.length <= 1200);
    assert.equal((p.match(/^```/gm) || []).length, 2);
  }
  for (let i = 0; i < 800; i++) assert.ok(pieces.join("\n").includes(`ROW_${i} `));
  const table =
    "| A | B |\n|---|---|\n" + Array.from({ length: 400 }, (_, i) => `| ${i} | value |`).join("\n");
  const tables = splitRichMarkdown(table, 1200);
  assert.ok(tables.length > 1);
  assert.ok(tables.every((p) => p.startsWith("| A | B |\n|---|---|")));
});
test("a rejected rich format falls back without losing text; transport errors are not duplicated", async () => {
  const calls = [];
  const api = {
    raw: {
      sendRichMessage: async () => {
        throw new GrammyError(
          "bad",
          { ok: false, error_code: 400, description: "Bad Request: can't parse rich message" },
          "sendRichMessage",
          {},
        );
      },
    },
    sendMessage: async (uid, text, extra) => {
      calls.push({ uid, text, extra });
      return { message_id: 8 };
    },
  };
  await sendFormatted(api, 101, "<b>literal</b> & table");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].extra.parse_mode, "HTML");
  assert.match(calls[0].text, /&lt;b&gt;/);
  calls.length = 0;
  api.raw.sendRichMessage = async () => {
    throw new Error("network down");
  };
  await assert.rejects(sendFormatted(api, 101, "hello"), /network down/);
  assert.equal(calls.length, 0);
});

test("paragraph spacing and large malformed fences preserve text without unbounded chunks", () => {
  assert.deepEqual(splitRichMarkdown("First paragraph\n\nSecond paragraph"), [
    "First paragraph\n\nSecond paragraph",
  ]);
  const raw = "`".repeat(2000) + "\nhello";
  const chunks = splitRichMarkdown(raw, 1200);
  assert.ok(chunks.every((c) => c.length <= 1200));
  assert.ok(chunks.join("").includes("hello"));
});

test("no artificial blank paragraph before tables, lists or fenced code", async () => {
  const sent = [];
  const api = {
    raw: {
      sendRichMessage: async (body) => {
        sent.push(body.rich_message.markdown);
        return { message_id: 1 };
      },
    },
  };
  for (const block of [
    "| Блок | Статус |\n|---|---|\n| API | Готово |",
    "- Первый\n- Второй",
    "```sh\nnpm test\n```",
  ]) {
    await sendFormatted(api, 101, "📋 Сводка\n\n" + block);
    assert.ok(
      !sent.at(-1).includes("\u00a0"),
      "Structured blocks must not receive a spacer paragraph",
    );
  }
});
