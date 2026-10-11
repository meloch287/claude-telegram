// Мост Claude бота ставится до открытия bb: агент, запись в bb, старый «Claude Code» выключен.
import test from "node:test";
import assert from "node:assert/strict";
import { createClaudeMirror, BRIDGE_PROVIDER } from "./claude-bb.mjs";

function fakes({ hasClaude = true } = {}) {
  const calls = [];
  let agents = null, claudeCodeOn = true;
  const request = async (url, init = {}) => {
    calls.push([init.method ?? "GET", url.replace("http://bb", "")]);
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.endsWith("/plugins/provider-acp/settings")) {
      if (init.method === "PUT") agents = body.values.customAgents;
      return { ok: true, json: async () => ({ values: { customAgents: agents } }) };
    }
    if (url.endsWith("/system/providers")) return { ok: true, json: async () => [{ id: "codex" }, ...(agents ? [{ id: BRIDGE_PROVIDER }] : []), { id: "claude-code", enabled: claudeCodeOn }] };
    if (url.endsWith("/claude-code/enabled")) { claudeCodeOn = body.enabled; return { ok: true }; }
    return { ok: false };
  };
  const mirror = createClaudeMirror({
    workerFor: () => { if (!hasClaude) throw Error("нет Claude"); return { uid: 61000, gid: 61000, home: "/h" }; },
    workspaceRoot: "/w", endpoint: async () => "http://bb", ensure: async (uid) => `ai-user-${uid}`,
    inContainer: async (cmd, args) => { calls.push(["exec", args.slice(0, 2).join(" ")]); return {}; }, request,
  });
  return { mirror, calls, state: () => ({ agents, claudeCodeOn }) };
}

test("bridge(): агент в контейнере, Claude бота в bb, старый Claude Code выключен", async () => {
  const f = fakes();
  assert.equal(await f.mirror.bridge(42), true);
  assert.ok(f.calls.some(([m, a]) => m === "exec" && a === "exec -i"), "агент записан в контейнер");
  assert.match(String(f.state().agents), /tgclaude/);
  assert.equal(f.state().claudeCodeOn, false);
});

test("bridge(): у кого нет Claude — ничего не трогаем", async () => {
  const f = fakes({ hasClaude: false });
  assert.equal(await f.mirror.bridge(42), false);
  assert.deepEqual(f.calls, []);
});
