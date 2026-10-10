import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
process.env.BOT_TOKEN = "test-token";
process.env.ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");
process.env.ALLOWED_USER_IDS = "101";
const { verifyInitData } = await import("../dist/crypto.js");
function sign(time = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ auth_date: String(time), user: JSON.stringify({ id: 101 }) });
  const payload = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update("test-token").digest();
  p.set("hash", createHmac("sha256", key).update(payload).digest("hex"));
  return p.toString();
}
test("Telegram signatures must have exact encoding, identity, and fresh timestamp", () => {
  assert.ok(verifyInitData(sign(), "test-token"));
  assert.equal(verifyInitData(sign() + "x", "test-token"), null);
  assert.equal(verifyInitData(sign().replace("101", "202"), "test-token"), null);
  assert.equal(verifyInitData(sign() + "&user=%7B%22id%22%3A202%7D", "test-token"), null);
  assert.equal(verifyInitData(sign(Math.floor(Date.now() / 1000) - 90000), "test-token"), null);
  assert.equal(verifyInitData(sign(Math.floor(Date.now() / 1000) + 3600), "test-token"), null);
});
