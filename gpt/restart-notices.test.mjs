import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyRestarted, RESTART_NOTICE } from "./restart-notices.mjs";
test("restart notifies affected users once, removes stale status and retains failed deliveries", async () => {
  const sent = [],
    deleted = [],
    cleared = [];
  const api = {
    async sendMessage(uid, body) {
      if (uid === 4) throw new Error("offline");
      sent.push([uid, body]);
    },
    async deleteMessage(uid, id) {
      deleted.push([uid, id]);
    },
  };
  await notifyRestarted(
    api,
    [1, 2, 3, 4],
    [{ chat_id: 1, message_id: 99 }],
    (uid) => uid !== 3,
    (uid) => cleared.push(uid),
  );
  assert.deepEqual(sent, [
    [1, RESTART_NOTICE],
    [2, RESTART_NOTICE],
  ]);
  assert.deepEqual(deleted, [[1, 99]]);
  assert.deepEqual(cleared, [1, 2, 3]);
  assert.match(RESTART_NOTICE, /продолжи/i);
});
