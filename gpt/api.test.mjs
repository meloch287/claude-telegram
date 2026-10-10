import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
const dir = mkdtempSync(join(tmpdir(), "gpt-api-test-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  BOT_TOKEN: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  ALLOWED_USER_IDS: "1057399602,202",
});
const { extraApi, setRevokeHandler } = await import("./api.mjs");
const { isGptUserAllowed } = await import("../dist/db.js");
const owner = 1057399602;
function signed(uid) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: uid }),
  };
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  return new URLSearchParams({
    ...fields,
    hash: createHmac("sha256", createHmac("sha256", "WebAppData").update("test").digest())
      .update(check)
      .digest("hex"),
  }).toString();
}
async function call(uid, url, body) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, {
    url: "/api/gpt/" + url,
    method: body ? "POST" : "GET",
    headers: { "x-telegram-init-data": uid ? signed(uid) : "" },
  });
  let code, data;
  await extraApi(req, {
    writeHead(c) {
      code = c;
    },
    end(raw) {
      data = JSON.parse(raw);
    },
  });
  return { code, data };
}
test("admin API rejects direct non-owner requests and revoked sessions", async () => {
  assert.equal((await call(null, "admin/users")).code, 401);
  assert.equal((await call(202, "admin/users")).code, 403);
  assert.equal((await call(202, "admin/user", { id: owner, allowed: false })).code, 403);
  let revoked;
  setRevokeHandler(async (id) => {
    revoked = id;
  });
  assert.equal((await call(owner, "admin/user", { id: 202, allowed: false })).code, 200);
  assert.equal(revoked, 202);
  assert.equal(isGptUserAllowed(202), false);
  assert.equal((await call(202, "chats")).code, 401);
  assert.equal((await call(owner, "admin/user", { id: owner, allowed: false })).code, 400);
});
test("admin API adds a user while friend Mini App cannot access dialog endpoints", async () => {
  assert.equal(
    (await call(owner, "admin/user", { id: 303, allowed: true, dialogLimit: 0, tokenLimit: 100 }))
      .code,
    200,
  );
  const chats = await call(303, "chats");
  assert.equal(chats.code, 403);
  assert.equal(chats.data.code, "MINIAPP_CATS_ONLY");
  for (const path of ["new", "model", "mode", "effort", "project"])
    assert.equal((await call(303, path, {})).code, 403);
  for (const path of ["projects", "chat?id=1"]) assert.equal((await call(303, path)).code, 403);
  const users = await call(owner, "admin/users");
  assert.equal(users.code, 200);
  const user = users.data.users.find((u) => u.id === 303);
  assert.equal(user.dialogLimit, 0);
  assert.equal(user.tokenLimit, 100);
});
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

test("full deletion requires owner and confirmation, protects owner and hides completed users", async () => {
  const { configureUserDeletion, waitForUserDeletion } = await import("./user-deletion.mjs");
  configureUserDeletion({ prepare: async () => {}, erase: async () => {} });
  assert.equal((await call(303, "admin/user-delete", { id: 202, confirmation: "202" })).code, 403);
  assert.equal(
    (await call(owner, "admin/user-delete", { id: owner, confirmation: String(owner) })).code,
    400,
  );
  assert.equal(
    (await call(owner, "admin/user-delete", { id: 303, confirmation: "wrong" })).code,
    400,
  );
  const result = await call(owner, "admin/user-delete", { id: 303, confirmation: "303" });
  assert.equal(result.code, 202);
  await waitForUserDeletion(303);
  assert.equal((await call(303, "chats")).code, 401);
  assert.equal((await call(owner, "admin/user-delete?id=303")).data.state, "complete");
  assert.ok(!(await call(owner, "admin/users")).data.users.some((user) => user.id === 303));
});

test("effort API persists per user and rejects unsupported levels for Luna", async () => {
  assert.equal((await call(owner, "effort", { effort: "ultra" })).code, 200);
  assert.equal((await call(owner, "chats")).data.effort, "ultra");
  assert.equal((await call(owner, "model", { model: "gpt-6-luna" })).code, 200);
  const view = (await call(owner, "chats")).data;
  assert.equal(view.effort, "medium");
  assert.equal(view.efforts.length, 5);
  assert.equal((await call(owner, "effort", { effort: "ultra" })).code, 400);
  assert.equal((await call(owner, "effort", { effort: "max" })).code, 200);
});

test("only owner can mint invite through POST; GET cannot mint", async () => {
  const { setInviteBotUsername } = await import("./api.mjs");
  setInviteBotUsername("fixture_bot");
  assert.equal((await call(null, "admin/invite", {})).code, 401);
  await call(owner, "admin/user", { id: 707, allowed: true });
  assert.equal((await call(707, "admin/invite", {})).code, 403);
  assert.equal((await call(owner, "admin/invite")).code, 405);
  const result = await call(owner, "admin/invite", {});
  assert.equal(result.code, 200);
  assert.match(result.data.url, /^https:\/\/t.me\/fixture_bot\?start=invite_[A-Za-z0-9_-]{32}$/);
  assert.ok(result.data.expiresAt > Date.now());
});

test("each user reads only personal quota; account limits and breakdown are owner-only", async () => {
  const store = await import("./store.mjs");
  const { subscriptionMonitor } = await import("./subscription.mjs");
  const original = subscriptionMonitor.get;
  subscriptionMonitor.get = async () => ({ buckets: [], stale: true });
  try {
    await call(owner, "admin/user", {
      id: 808,
      allowed: true,
      tokenLimit: 1000,
      weeklyLimit: 5000,
      quotaMode: "weighted",
    });
    store.recordMeteredUsage(
      808,
      { input_tokens: 100, cached_input_tokens: 50 },
      "gpt-6-sol",
      "api:test",
    );
    const q = await call(808, "quota?user_id=" + owner);
    assert.equal(q.code, 200);
    assert.equal(q.data.daily.used, 55);
    assert.equal(q.data.subscription.limit, 10);
    assert.equal("buckets" in q.data.subscription, false);
    assert.equal((await call(owner, "quota")).data.subscription.limit, null);
    assert.equal(q.data.weekly.limit, 5000);
    assert.equal((await call(null, "quota")).code, 401);
    assert.equal((await call(808, "admin/accounting")).code, 403);
    const view = await call(owner, "admin/accounting");
    assert.equal(view.code, 200);
    assert.equal(view.data.today.units, 55);
    assert.equal((await call(owner, "quota")).data.daily.used, 0);
  } finally {
    subscriptionMonitor.get = original;
  }
});

test("owner edits percentage limit and ordinary users cannot edit quotas", async () => {
  const result = await call(owner, "admin/user", { id: 919, allowed: true, percentLimit: 12.5 });
  assert.equal(result.code, 200);
  assert.equal((await call(919, "quota")).data.subscription.limit, 12.5);
  assert.equal((await call(919, "admin/user", { id: 919, percentLimit: 100 })).code, 403);
  assert.equal((await call(owner, "admin/user", { id: 919, percentLimit: 101 })).code, 400);
  const users = (await call(owner, "admin/users")).data.users;
  assert.equal(users.find((u) => u.id === 919).percentLimit, 12.5);
});
