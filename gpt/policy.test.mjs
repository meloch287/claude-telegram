import { test } from "node:test";
import assert from "node:assert/strict";
import { workerArgs, readWorkerArgs, userId, relativeFile, modelId, workspace } from "./policy.mjs";
test("rejects untrusted identities and paths", () => {
  for (const id of [0, -1, "123", NaN, 1.2, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => userId(id));
  for (const p of ["../etc/passwd", "/etc/passwd", "a/../../b", "x\0y"])
    assert.throws(() => relativeFile(p));
  assert.equal(relativeFile("a/../b.txt"), "b.txt");
  assert.equal(workspace(123, "../../456"), "/app/workspaces/123/456");
  assert.throws(() => modelId("gpt-6-sol --config=x"));
});
test("read mode mounts user files read-only and permits only Codex runtime writes", () => {
  const args = readWorkerArgs(123, "/opt/ai-bot/tenants");
  const mounts = args.flatMap((v, i) => (v === "--mount" ? [args[i + 1]] : []));
  assert.equal(mounts.length, 3);
  assert.ok(
    mounts
      .filter((m) => !m.endsWith("readonly"))
      .every((m) => m.includes("/home/.codex,dst=/home/agent/.codex")),
  );
  assert.ok(mounts.some((m) => m.endsWith("/app/workspaces/123,readonly")));
  assert.ok(args.includes("--cap-drop=ALL"));
  assert.ok(args.includes("--security-opt=no-new-privileges:true"));
});
test("tenants receive exactly their own two mounts and no host privileges", () => {
  for (const uid of [123, 456]) {
    const args = workerArgs(uid, "/opt/ai-bot/tenants");
    const mounts = args.flatMap((v, i) => (v === "--mount" ? [args[i + 1]] : []));
    assert.equal(mounts.length, 2);
    assert.ok(mounts.every((m) => m.startsWith(`type=bind,src=/opt/ai-bot/tenants/${uid}/`)));
    assert.ok(args.includes("--read-only"));
    assert.ok(args.includes("--cap-drop=ALL"));
    assert.ok(args.includes("--security-opt=no-new-privileges:true"));
    assert.ok(args.includes("1000:1000"));
    assert.ok(!args.join(" ").includes("docker.sock"));
    assert.ok(!args.includes("--privileged"));
    assert.ok(!args.includes("--network=host"));
  }
});
