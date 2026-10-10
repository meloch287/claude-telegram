import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
const dir = mkdtempSync(join(tmpdir(), "gpt-invites-test-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  BOT_TOKEN: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  ALLOWED_USER_IDS: "1057399602,202",
});
const legacy = await import("../dist/db.js");
const store = await import("./store.mjs");
const { redeemInvitation } = await import("./invites.mjs");
const db = new DatabaseSync(join(dir, "bot.db"));
const owner = 1057399602;
const mint = () => store.createInvite(owner).token;

test("owner creates unpredictable, hashed, expiring one-use invites", () => {
  assert.throws(() => store.createInvite(202));
  const { token, expiresAt } = store.createInvite(owner);
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(token, mint());
  assert.ok(Math.abs(expiresAt - Date.now() - 7 * 86400000) < 1000);
  const hash = createHash("sha256").update(token).digest("hex");
  assert.ok(db.prepare("SELECT 1 FROM gpt_invites WHERE token_hash=?").get(hash));
  assert.equal(store.redeemInvite(303, token), true);
  assert.equal(legacy.isGptUserAllowed(303), true);
  assert.equal(store.userPolicy(303).token_limit, null);
  assert.equal(store.userPolicy(303).dialog_limit, 5);
  assert.throws(() => store.redeemInvite(304, token), /использована/);
  assert.equal(store.redeemInvite(303, token, true), false);
  store.setUserPolicy(owner, 303, { allowed: false });
  assert.throws(() => store.redeemInvite(303, token), /использована/);
  assert.equal(legacy.isGptUserAllowed(303), false);
});

test("existing authorized users retain custom limits and leave invite available", () => {
  store.setUserPolicy(owner, 202, { tokenLimit: 42, dialogLimit: 100 });
  const token = mint();
  assert.equal(store.redeemInvite(202, token, true), false);
  assert.equal(store.userPolicy(202).token_limit, 42);
  assert.equal(store.userPolicy(202).dialog_limit, 100);
  assert.equal(store.redeemInvite(305, token), true);
});

test("invalid, expired and deleting recipients cannot redeem; transaction rolls back", () => {
  for (const token of ["", "a".repeat(32), "a".repeat(100)])
    assert.throws(() => store.redeemInvite(306, token));
  const expired = mint();
  db.prepare("UPDATE gpt_invites SET expires_at=1 WHERE token_hash=?").run(
    createHash("sha256").update(expired).digest("hex"),
  );
  assert.throws(() => store.redeemInvite(306, expired), /истекло/);
  db.prepare("INSERT INTO gpt_user_deletions(user_id,state,at) VALUES(306,'pending',1)").run();
  const token = mint();
  assert.throws(() => store.redeemInvite(306, token), /удаление/);
  assert.equal(legacy.isGptUserAllowed(306), false);
  assert.equal(store.redeemInvite(307, token), true);
});

test("private start admits new recipient before allowlist and ordinary start needs no state", async () => {
  const replies = [];
  const ctx = {
    from: { id: 308 },
    chat: { type: "private" },
    message: { text: "/start invite_" + mint() },
    reply: (s) => replies.push(s),
  };
  let passed = 0;
  await redeemInvitation(ctx, () => {
    assert.equal(legacy.isGptUserAllowed(308), true);
    passed++;
  });
  assert.equal(ctx.inviteGranted, true);
  assert.equal(passed, 1);
  const ordinary = { ...ctx, message: { text: "/start" } };
  await redeemInvitation(ordinary, () => passed++);
  assert.equal(passed, 2);
  await redeemInvitation({ ...ctx, from: { id: 309 } }, () => passed++);
  assert.equal(passed, 2);
  assert.match(replies[0], /использована/);
  await redeemInvitation(
    {
      ...ctx,
      from: { id: 309 },
      chat: { type: "group" },
      message: { text: "/start invite_" + mint() },
    },
    () => {},
  );
  assert.equal(legacy.isGptUserAllowed(309), false);
  legacy.getOrCreateUser(308);
  legacy.setTelegramIdentity(308, "Имя Фамилия", "nickname");
  const user = legacy.getOrCreateUser(308);
  assert.equal(user.display_name, "Имя Фамилия");
  assert.equal(user.telegram_username, "nickname");
  legacy.setTelegramIdentity(308, "Имя", null);
  assert.equal(legacy.getOrCreateUser(308).telegram_username, null);
});
process.on("exit", () => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
