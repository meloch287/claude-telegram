import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createAttachmentBatches } from "./attachment-batches.mjs";
const ctx = (id) => ({ from: { id } });
function fixture(prepare) {
  const submitted = [],
    edits = [],
    tracked = [];
  const batch = createAttachmentBatches({
    api: {
      sendMessage: async () => ({ message_id: 1 }),
      editMessageText: async (...args) => edits.push(args[2]),
      deleteMessage: async () => {},
    },
    prepare,
    submit: async (...args) => submitted.push(args),
    allowed: () => true,
    track: (_, p) => tracked.push(p),
    quietMs: 30,
    tickMs: 10,
  });
  return { batch, submitted, edits, tracked };
}
test("two attachments wait for transcription, join in arrival order, keep the original dialog", async () => {
  let release;
  const blocked = new Promise((r) => {
    release = r;
  });
  const f = fixture(async (_, thread, item, signal, progress) => {
    await progress("🎙 Расшифровываю");
    if (item === 1) await blocked;
    return "text " + item + " " + thread.id;
  });
  f.batch.add(ctx(1), { id: "A" }, 1, "first");
  f.batch.add(ctx(1), { id: "A" }, 2, "second");
  assert.equal(f.batch.addText(ctx(1), "A", "Сравни оба"), true);
  await sleep(50);
  assert.equal(f.submitted.length, 0);
  assert.ok(f.edits.some((s) => s.includes("Расшифровываю")));
  release();
  await Promise.all(f.tracked);
  assert.equal(f.submitted.length, 1);
  assert.equal(f.submitted[0][2], "A");
  assert.match(f.submitted[0][1], /Сравни оба/);
  assert.ok(f.submitted[0][1].indexOf("text 1") < f.submitted[0][1].indexOf("text 2"));
});
test("users and dialogs are separate; a failed attachment never launches a partial task", async () => {
  const f = fixture(async (_, t, item) => {
    if (item === "bad") throw new Error("decode failed");
    return item;
  });
  f.batch.add(ctx(1), { id: "A" }, "good", "a");
  f.batch.add(ctx(1), { id: "A" }, "bad", "b");
  f.batch.add(ctx(2), { id: "A" }, "other user", "c");
  f.batch.add(ctx(1), { id: "B" }, "other dialog", "d");
  await sleep(60);
  await Promise.all(f.tracked);
  assert.equal(f.submitted.length, 2);
  assert.ok(f.edits.some((s) => s.includes("неполный набор")));
  assert.equal(f.submitted.find((s) => s[0].from.id === 2)[1].includes("other dialog"), false);
});
test("stop aborts transcription and prevents any later submission", async () => {
  const f = fixture(async (_, t, item, signal) => {
    await sleep(500, undefined, { signal });
    return item;
  });
  f.batch.add(ctx(1), { id: "A" }, "voice", "voice");
  await sleep(5);
  await f.batch.cancel(1);
  await Promise.all(f.tracked);
  await sleep(40);
  assert.equal(f.submitted.length, 0);
  assert.deepEqual(f.batch.users(), []);
});
