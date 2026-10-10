import { gptModels } from "./gpt-models.mjs";
import {createHash} from "node:crypto";
import {teamContext} from "./team-space.mjs";
import { GITHUB_CONTEXT } from "./github.mjs";
import { docker, ensureWorker } from "./worker.mjs";
import { issueInference } from "./inference-gateway.mjs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
export const BB_IMAGE = "ai-worker:0.159.3-bb0.45.0-r33-claude";

// BB and its Codex children run as UID 1000 inside the EXISTING user worker.
// No extra mounts, published ports, Docker socket, or owner credentials.
export function createWebRuntime({ auth, allowed, settings, credential = () => null, onReady = async () => {},prepareTeam=async()=>{} }) {
  const readyCache=new Map();
  const starting = new Map(),
    tickets = new Map();
  function register(uid) {
    const entry = auth.ensure(uid);
    if (tickets.get(uid)?.token !== entry.token) {
      tickets.get(uid)?.release();
      tickets.set(uid, issueInference(uid, "gpt-6-sol", "medium", null, entry.token));
    }
    return entry;
  }
  for (const { uid } of auth.users()) register(uid);
  async function address(uid) {
    const name = await ensureWorker(uid);
    const result = JSON.parse((await docker(["inspect", name])).stdout)[0];
    if (result.Config.Image !== BB_IMAGE) throw Error("Обновление веб-окружения ещё не завершено");
    const ip = result.NetworkSettings.Networks["ai-workers"]?.IPAddress;
    if (!/^172\.30\.0\.\d+$/.test(ip || "")) throw Error("Invalid worker network");
    return { name, url: `http://${ip}:38886` };
  }
  async function ready(url) {
    try {
      return (await fetch(url + "/health", { signal: AbortSignal.timeout(1500) })).ok;
    } catch {
      return false;
    }
  }
  const configured = new Set(), credentialsChecked = new Map();
  const credentialSync = readFile(new URL("./bb-credential-sync.py", import.meta.url), "utf8");
  async function syncCredential(uid, target, claude) {
    const token = claude?.kind === "subscription" ? claude.secret : "";
    const fingerprint = createHash("sha256").update(token).digest("hex");
    if (credentialsChecked.get(uid) === fingerprint) return;
    const script = await credentialSync;
    await new Promise((resolve, reject) => {
      const child = spawn("docker", ["exec", "-i", target.name, "python3", "-c", script], {stdio:["pipe","ignore","ignore"]});
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve() : reject(Error("Не удалось обновить подключение Claude")));
      child.stdin.on("error", reject);
      child.stdin.end(JSON.stringify({token}));
    });
    configured.delete(uid);
    credentialsChecked.set(uid, fingerprint);
  }
  async function bootstrap(uid, target) {
    if (configured.has(uid)) return target.url;
    await docker(["exec", target.name, "bb", "plugin", "disable", "connect", "--json"]);
    const hasClaude = credential(uid)?.kind === "subscription";
    // «Claude Code» контейнера — только пока нет моста к Claude бота: с мостом он
    // выключен (claude-bb.mjs), иначе чаты из bb шли бы мимо бота.
    const bridged = await docker(["exec", target.name, "test", "-f", "/home/agent/.bb/tg-claude-acp.mjs"]).then(() => true, () => false);
    if (hasClaude && !bridged)
      await docker(["exec", target.name, "bb", "provider", "enable", "claude-code", "--json"]);
    const marked = await docker([
      "exec",
      target.name,
      "test",
      "-f",
      "/home/agent/.bb/gpt-bootstrap-v2",
    ]).then(
      () => true,
      () => false,
    );
    if (!marked) {
      async function api(path, method = "GET", body) {
        const response = await fetch(target.url + "/api/v1" + path, {
          method,
          headers: { "content-type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw Error(`bb setup ${path}: ${response.status}`);
        return response.json();
      }
      const config = await api("/system/config");
      await api("/settings/general", "PUT", {
        ...config.generalSettings,
        defaultProviderId: "codex",
        allowFastServiceTier: false,
        telemetryEnabled: false,
        machineGitCredentialsEnabled: false,
      });
      const projects = await api("/projects");
      if (!projects.some((p) => p.sources?.some((s) => s.path === `/app/workspaces/${uid}`))) {
        const hosts = await api("/hosts"),
          host = hosts.find((h) => h.status === "connected");
        if (!host) throw Error("Окружение ещё подключается. Повтори /web.");
        await api("/projects", "POST", {
          name: "Моя рабочая зона",
          source: { hostId: host.id, type: "local_path", path: `/app/workspaces/${uid}` },
        });
      }
      // bb 0.45 has no setter for initial project defaults. Seed only missing
      // preferences in its pinned schema; never replace the user's saved choices.
      await docker([
        "exec",
        target.name,
        "python3",
        "-c",
        "import sqlite3,time; c=sqlite3.connect('/home/agent/.bb/bb.db',timeout=15); c.execute(\"INSERT OR IGNORE INTO project_execution_defaults(project_id,provider_id,model,service_tier,reasoning_level,permission_mode,updated_at) SELECT id,'codex','gpt-6-sol','default','medium','full',? FROM projects\",(int(time.time()*1000),)); c.commit()",
      ]);
      await docker(["exec", target.name, "touch", "/home/agent/.bb/gpt-bootstrap-v2"]);
    }
    configured.add(uid);
    return target.url;
  }
  async function boot(uid) {
    if (!allowed(uid)) throw Error("Нет доступа");
    await prepareTeam(uid);
    const entry = register(uid),
      target = await address(uid);
    const claude = credential(uid);
    await syncCredential(uid, target, claude);
    if (await ready(target.url)) return bootstrap(uid, target);
    const user = settings(uid);
    const config = `model = "${user.model || "gpt-6-sol"}"\nmodel_reasoning_effort = "${user.effort || "medium"}"\nmodel_catalog_json = "/tmp/bb-models.json"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\nmodel_provider = "owner_gateway"\n[model_providers.owner_gateway]\nname = "GPT subscription"\nbase_url = "http://172.30.0.1:8790/v1"\nwire_api = "responses"\nenv_key = "GPT_BROKER_TOKEN"\nsupports_websockets = false\n`;
    // Каталог моделей — свежий из Codex, если есть (gpt-models.mjs), иначе встроенный.
    const live = gptModels.catalogJson();
    const catalog = live ? Buffer.from(live) : await readFile(new URL("./bb-models.json", import.meta.url));
    await new Promise((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          "exec",
          "-i",
          target.name,
          "python3",
          "-c",
          "import sys;open('/tmp/bb-models.json','wb').write(sys.stdin.buffer.read())",
        ],
        { stdio: ["pipe", "ignore", "ignore"] },
      );
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(Error("Не удалось подготовить каталог моделей bb")),
      );
      child.stdin.on("error", reject);
      child.stdin.end(catalog);
    });
    const script = `import os,json\nroot='/home/agent/.bb-codex'\nos.makedirs(root,exist_ok=True)\nopen(root+'/AGENTS.md','w').write(${JSON.stringify(GITHUB_CONTEXT+"\n<!-- ai-team -->\n"+teamContext(uid,"gpt")+"\n<!-- /ai-team -->\n")})\nopen(root+'/config.toml','w').write(${JSON.stringify(config)})\nopen(root+'/auth.json','w').write(json.dumps({'auth_mode':'apikey','OPENAI_API_KEY':os.environ['GPT_BROKER_TOKEN']}))\nos.chmod(root+'/auth.json',0o600)\nos.makedirs('/home/agent/.bb',exist_ok=True)\n`;
    await docker([
      "exec",
      "-e",
      `GPT_BROKER_TOKEN=${entry.token}`,
      target.name,
      "python3",
      "-c",
      script,
    ]);
    if (claude?.kind === "subscription") {
      // Pass the secret over stdin; remove the launch file as soon as bb starts.
      await new Promise((resolve, reject) => {
        const child = spawn("docker", [
          "exec", "-i", target.name, "python3", "-c",
          "import os,sys; p='/home/agent/.bb/.claude-launch-token'; f=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600); os.write(f,sys.stdin.buffer.read()); os.close(f); os.chmod(p,0o600)",
        ], { stdio: ["pipe", "ignore", "ignore"] });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 ? resolve() : reject(Error("Не удалось передать токен Claude в bb")),
        );
        child.stdin.on("error", reject);
        child.stdin.end(claude.secret);
      });
    }
    if (!allowed(uid)) throw Error("Нет доступа");
    await docker([
      "exec",
      "-d",
      "-w",
      `/app/workspaces/${uid}`,
      "-e",
      `GPT_BROKER_TOKEN=${entry.token}`,
      "-e",
      `OPENAI_API_KEY=${entry.token}`,
      "-e",
      "OPENAI_BASE_URL=http://172.30.0.1:8790/v1",
      "-e",
      "CODEX_HOME=/home/agent/.bb-codex",
      "--env",
      "GIT_CONFIG_GLOBAL=/home/agent/.gitconfig",
      "-e",
      "BB_DATA_DIR=/home/agent/.bb",
      "-e",
      `BB_APP_URL=${auth.origin(uid)}`,
      "-e",
      "BB_TELEMETRY=false",
      "-e",
      "BB_CLAUDE_CODE_EXECUTABLE=/usr/local/bin/claude",
      target.name,
      "sh",
      "-c",
      "if [ -f /home/agent/.bb/.claude-launch-token ]; then export CLAUDE_CODE_OAUTH_TOKEN=$(cat /home/agent/.bb/.claude-launch-token); rm -f /home/agent/.bb/.claude-launch-token; fi; exec bb-app --server-bind-host 0.0.0.0 >>/home/agent/.bb/launcher.log 2>&1",
    ]);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (!allowed(uid)) throw Error("Нет доступа");
      if (await ready(target.url)) return bootstrap(uid, target);
      await new Promise((r) => setTimeout(r, 700));
    }
    throw Error("bb ещё запускается. Открой ссылку повторно через минуту.");
  }
  return {
    async endpoint(uid) {
      const target = await address(uid);
      return (await ready(target.url)) ? target.url : null;
    },
    ensure(uid) {
      if(!allowed(uid))return Promise.reject(Error("Нет доступа"));
      const cached=readyCache.get(uid);if(cached&&cached.until>Date.now())return Promise.resolve(cached.url);
      if (!starting.has(uid))
        starting.set(
          uid,
          boot(uid)
            .then(async (url) => {
              await onReady(uid);
              readyCache.set(uid,{url,until:Date.now()+5000});
              return url;
            })
            .finally(() => starting.delete(uid)),
        );
      return starting.get(uid);
    },
    async count(uid) {
      const { url } = await address(uid);
      if (!(await ready(url))) return 0;
      const result = await fetch(
        url + "/api/v1/threads/count?includeArchived=true&parentThreadId=none",
        { signal: AbortSignal.timeout(5000) },
      );
      if (!result.ok) throw Error("Не удалось проверить диалоги bb");
      const data = await result.json();
      if (!Number.isSafeInteger(data.total)) throw Error("Invalid bb thread count");
      return data.total;
    },
    async revoke(uid) {
      readyCache.delete(uid);
      auth.revoke(uid);
      configured.delete(uid);
      credentialsChecked.delete(uid);
      tickets.get(uid)?.release();
      tickets.delete(uid);
      // Restart kills bb, terminal sessions, and all their child processes.
      await starting.get(uid)?.catch(() => {});
      await docker(["restart", "--time", "2", `ai-user-${uid}`]).catch(() => {});
    },
  };
}
