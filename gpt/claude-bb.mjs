// Зеркало Telegram-диалогов Claude в bb (вкладка Claude рабочей зоны).
// Выгрузка идёт от имени пользователя на хосте (claude-bb-export.py), запись — в его
// контейнере (claude-bb-sync.py). Односторонне и не чаще раза в 30 секунд на человека;
// перечитываются только изменившиеся диалоги.
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { ensureWorker } from "./worker.mjs";

const exportScript = new URL("./claude-bb-export.py", import.meta.url).pathname;
const syncScript = await readFile(new URL("./claude-bb-sync.py", import.meta.url), "utf8");
const agentScript = await readFile(new URL("./tg-claude-acp.mjs", import.meta.url), "utf8");
const agentHash = createHash("sha256").update(agentScript).digest("hex");
const AGENT_PATH = "/home/agent/.bb/tg-claude-acp.mjs";
export const BRIDGE_PROVIDER = "acp-tgclaude";

/** Запись агента в настройке Custom agents плагина ACP (провайдер acp-tgclaude). */
export function agentEntry(uid) {
  return { id: "tgclaude", displayName: "Claude", command: "node", args: [AGENT_PATH], env: { TG_CLAUDE_CONFIG: `/app/workspaces/${uid}/AI-bot/User${uid}/.ai-team.json` } };
}

/** Добавляет или обновляет агента, не трогая чужие записи. null — менять нечего. */
export function mergeCustomAgents(current, entry) {
  let list = [];
  try { const parsed = JSON.parse(current || "[]"); if (Array.isArray(parsed)) list = parsed; } catch { list = []; }
  const index = list.findIndex((a) => a && a.id === entry.id);
  if (index >= 0 && JSON.stringify(list[index]) === JSON.stringify(entry)) return null;
  if (index >= 0) list[index] = entry; else list.push(entry);
  return JSON.stringify(list, null, 1);
}
const INTERVAL = 30_000;

function run(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", size = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stdout.on("data", (b) => { size += b.length; if (size > 64 * 1024 * 1024) child.kill("SIGKILL"); else out += b; });
    child.stderr.on("data", (b) => { if (err.length < 2000) err += b; });
    child.once("error", (e) => { clearTimeout(timer); reject(e); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(Error(`${command} завершился с кодом ${code}: ${err.trim().slice(-300)}`));
      try { resolve(JSON.parse(out)); } catch { reject(Error("Нечитаемый ответ зеркала Claude")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

export function createClaudeMirror({ workerFor, workspaceRoot, endpoint, exportAs = run, inContainer = run, ensure = ensureWorker, now = Date.now, request = fetch }) {
  const state = new Map(); // uid → { at, known: Map<id, mtime> }
  const active = new Map();
  const bridged = new Map(); // uid → хэш агента, с которым мост уже настроен

  /** Агент в контейнере и запись в настройках bb. true — мост готов. */
  async function ensureBridge(uid, name) {
    if (bridged.get(uid) === agentHash) return true;
    const target = endpoint ? await endpoint(uid) : null;
    if (!target) return false;
    await inContainer("docker", ["exec", "-i", name, "python3", "-c",
      "import os,sys,json;d=json.load(sys.stdin);p=d['path'];t=p+'.tmp';open(t,'w').write(d['body']);os.chmod(t,0o644);os.replace(t,p);print('{}')"],
      { path: AGENT_PATH, body: agentScript });
    const url = `${target}/api/v1/plugins/provider-acp/settings`;
    const current = await request(url, { signal: AbortSignal.timeout(10_000) });
    if (!current.ok) return false;
    const view = await current.json();
    const next = mergeCustomAgents(view?.values?.customAgents, agentEntry(uid));
    if (next !== null) {
      const saved = await request(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ values: { customAgents: next } }), signal: AbortSignal.timeout(10_000) });
      if (!saved.ok) return false;
    }
    bridged.set(uid, agentHash);
    return true;
  }

  async function syncOnce(uid) {
    let worker;
    try { worker = workerFor(uid); } catch { return null; } // у человека нет Claude
    const previous = state.get(uid);
    // Раз в полчаса — полная пересылка: на случай, если базу bb пересоздали.
    const memo = previous && now() - previous.full < 30 * 60_000 ? previous : { at: 0, full: now(), known: new Map() };
    const rows = await exportAs("python3", [exportScript, worker.home, `${workspaceRoot}/${uid}`], { known: Object.fromEntries(memo.known) }, {
      uid: worker.uid, gid: worker.gid, cwd: worker.home, env: { PATH: "/usr/bin:/bin", HOME: worker.home, LANG: "C.UTF-8" },
    });
    const name = await ensure(uid);
    const ready = await ensureBridge(uid, name).catch((error) => { console.error("[claude-bb] мост:", uid, error.message); return false; });
    const provider = ready ? BRIDGE_PROVIDER : "claude-code";
    // Сменился провайдер — переслать всё, чтобы ветки переключились.
    if (memo.provider !== provider) memo.known = new Map();
    const fresh = memo.provider !== provider ? await exportAs("python3", [exportScript, worker.home, `${workspaceRoot}/${uid}`], { known: {} }, {
      uid: worker.uid, gid: worker.gid, cwd: worker.home, env: { PATH: "/usr/bin:/bin", HOME: worker.home, LANG: "C.UTF-8" },
    }) : rows;
    const result = await inContainer("docker", ["exec", "-i", name, "python3", "-c", syncScript, String(uid), "/home/agent", `/app/workspaces/${uid}`], { sessions: fresh.filter((r) => !r.unchanged), ids: fresh.map((r) => r.id), complete: true, provider });
    state.set(uid, { ...memo, at: now() });
    if (result?.ready) {
      memo.provider = provider;
      // Запоминаем версию только для записанных диалогов; занятые в bb повторим позже.
      const busy = new Set((result.threads ?? []).filter((t) => t.status !== "idle").map((t) => t.id));
      const known = new Map();
      for (const r of fresh) if (!busy.has(r.id) && (r.unchanged ? memo.known.has(r.id) : true)) known.set(r.id, r.mtime);
      state.set(uid, { at: now(), full: memo.full, known, provider });
    }
    return result;
  }

  return {
    sync(uid, { force = false } = {}) {
      if (active.has(uid)) return active.get(uid);
      if (!force && now() - (state.get(uid)?.at ?? 0) < INTERVAL) return Promise.resolve(null);
      const task = syncOnce(uid).finally(() => active.delete(uid));
      active.set(uid, task);
      return task;
    },
  };
}
