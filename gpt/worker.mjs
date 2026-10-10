import {deliveryPath} from "../dist/bot/delivery.js";
import { createLiveTurn } from "./live-turn.mjs";
import { normalizeUsage } from "./token-usage.mjs";
import { sharedAccountEnabled, ownerConnected, OWNER_ID } from "./owner-auth.mjs";
import { issueInference } from "./inference-gateway.mjs";
import { effortId } from "./reasoning.mjs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, realpath, readFile as readSource } from "node:fs/promises";
import { userId, workerArgs, readWorkerArgs, workspace, relativeFile } from "./policy.mjs";

const webSyncScript = await readSource(new URL("./bb-sync.py", import.meta.url), "utf8");
const dialogScript = await readSource(new URL("./dialog-files.py", import.meta.url), "utf8");
const usageScript = await readSource(new URL("./session-usage.py", import.meta.url), "utf8");
const exec = promisify(execFile);
const base = process.env.TENANT_ROOT || "/opt/ai-bot/tenants";
const provisioned = new Map();
const workerRemovals = new Map();
export async function docker(args, options = {}) {
  return exec("docker", args, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, ...options });
}
export async function ensureWorker(uid) {
  const id = userId(uid);
  if (provisioned.has(id)) return provisioned.get(id);
  const task = (async () => {
    const name = `ai-user-${id}`;
    const inspect = await docker(["inspect", name])
      .then((r) => JSON.parse(r.stdout)[0])
      .catch(() => null);
    if (inspect) {
      if (
        inspect.Config.Labels?.["ai-bot.user"] !== id ||
        inspect.Config.User !== "1000:1000" ||
        !inspect.HostConfig.ReadonlyRootfs ||
        inspect.HostConfig.Privileged ||
        inspect.HostConfig.NetworkMode !== "ai-workers" ||
        !inspect.HostConfig.CapDrop?.includes("ALL") ||
        !inspect.HostConfig.SecurityOpt?.includes("no-new-privileges:true") ||
        inspect.HostConfig.PidMode === "host" ||
        inspect.HostConfig.IpcMode !== "private"
      )
        throw new Error("Worker security configuration mismatch");
      const expected = new Map([
        [`${base}/${id}/home`, "/home/agent"],
        [`${base}/${id}/workspace`, `/app/workspaces/${id}`],
      ]);
      if (
        inspect.Mounts.length !== 2 ||
        inspect.Mounts.some((m) => expected.get(m.Source) !== m.Destination)
      )
        throw new Error("Unexpected worker mount");
      if (!inspect.State.Running) await docker(["start", name]);
      return name;
    }
    await mkdir(`${base}/${id}/home/.codex`, { recursive: true, mode: 0o700 });
    await mkdir(`${base}/${id}/workspace/default`, { recursive: true, mode: 0o700 });
    for (const directory of [`${base}/${id}/home`, `${base}/${id}/workspace`]) {
      if ((await realpath(directory)) !== directory)
        throw new Error("Tenant mount must not be a symlink");
    }
    // Only controller-created directories: no recursive traversal through tenant files.
    for (const p of [
      `${base}/${id}/home`,
      `${base}/${id}/home/.codex`,
      `${base}/${id}/workspace`,
      `${base}/${id}/workspace/default`,
    ])
      await exec("chown", ["1000:1000", p]);
    await docker(workerArgs(uid, base), { timeout: 120_000 });
    return name;
  })();
  provisioned.set(id, task);
  try {
    return await task;
  } catch (error) {
    provisioned.delete(id);
    throw error;
  }
}
export async function prepareProject(uid, project, dialogId) {
  if (dialogId) {
    await dialogAction(uid, dialogId, "prepare");
    return dialogPaths(uid, dialogId).workspace;
  }
  const name = await ensureWorker(uid),
    cwd = workspace(uid, project);
  await docker(["exec", name, "mkdir", "-p", "--", cwd]);
  return cwd;
}
export async function runInWorker(uid, args, options = {}) {
  const name = await ensureWorker(uid);
  return docker(["exec", name, ...args], options);
}
export async function authStatus(uid) {
  if (sharedAccountEnabled()) return ownerConnected();
  const r = await runInWorker(uid, ["codex", "login", "status"]).catch(() => null);
  return !!r && /Logged in using ChatGPT/.test(r.stdout + r.stderr);
}
export async function startLogin(uid) {
  if (sharedAccountEnabled() && uid !== OWNER_ID)
    throw new Error("Подключение выполняет владелец бота");
  const name = await ensureWorker(uid);
  return spawn("docker", ["exec", "-i", name, "codex", "login", "--device-auth"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}
export async function stopWorkerTasks(uid) {
  const name = await ensureWorker(uid);
  await docker(["rm", "-f", `ai-read-${userId(uid)}`]).catch(() => {});
  // Restart terminates the complete process tree, including shell children.
  await docker(["restart", "--time", "2", name], { timeout: 20_000 });
}
export async function stopStorageWorker(uid) {
  const id = userId(uid);
  provisioned.delete(id);
  await docker(["rm", "-f", `ai-read-${id}`]).catch(() => {});
  const exists = await docker([
    "inspect",
    "--format",
    "{{.State.Running}}",
    `ai-user-${id}`,
  ]).catch((error) => {
    if (/No such (object|container)/.test(error.stderr || "")) return null;
    throw error;
  });
  if (exists?.stdout.trim() === "true")
    // Owner's idle container also serves read-only account limit checks for everyone.
    await docker([uid === OWNER_ID ? "restart" : "stop", "--time", "2", `ai-user-${id}`], {
      timeout: 20000,
    });
}
export async function startTurn(
  uid,
  project,
  model,
  thread,
  prompt,
  mode = "auto",
  dialogId,
  effort = "medium",
  jobId = null,
  images = [],
) {
  const cwd = await prepareProject(uid, project, dialogId);
  const shared = sharedAccountEnabled() && uid !== OWNER_ID;
  effortId(effort, model);
  if (dialogId && !shared) await dialogAction(uid, dialogId, "auth");
  const name = mode === "read" ? await ensureReadWorker(uid, dialogId) : await ensureWorker(uid);
  const args = [
    "exec",
    "-i",
    "-e",
    "GIT_CONFIG_GLOBAL=/home/agent/.gitconfig",
    "--workdir",
    cwd,
    name,
    "codex",
    "app-server",
    "-c",
    `model="${model}"`,
    "-c",
    'sandbox_mode="danger-full-access"',
    "-c",
    `model_reasoning_effort="${effort}"`,
    "-c",
    'approval_policy="never"',
  ];
  if (dialogId) {
    const { home, codex } = dialogPaths(uid, dialogId);
    args.splice(
      2,
      0,
      "-e",
      `HOME=${home}`,
      "-e",
      `CODEX_HOME=${codex}`,
      "-e",
      `TMPDIR=${home}/tmp`,
      "-e",
      `XDG_CACHE_HOME=${home}/.cache`,
      "-e",
      `NPM_CONFIG_PREFIX=${home}/.local`,
      "-e",
      `PIP_CACHE_DIR=${home}/.cache/pip`,
    );
  }
  // Read mode is enforced by read-only Docker mounts, without privileged namespaces.

  let ticket;
  if (shared) {
    ticket = issueInference(uid, model, effort, jobId);
    args.splice(2, 0, "-e", `GPT_BROKER_TOKEN=${ticket.token}`);
    args.splice(
      args.length,
      0,
      "-c",
      'model_provider="owner_gateway"',
      "-c",
      'cli_auth_credentials_store="ephemeral"',
      "-c",
      'model_providers.owner_gateway.name="Owner subscription"',
      "-c",
      'model_providers.owner_gateway.base_url="http://172.30.0.1:8790/v1"',
      "-c",
      'model_providers.owner_gateway.env_key="GPT_BROKER_TOKEN"',
      "-c",
      'model_providers.owner_gateway.wire_api="responses"',
    );
  }
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  if (ticket) {
    child.once("close", ticket.release);
    child.once("error", ticket.release);
  }
  const live = createLiveTurn(child, {
    model,
    effort,
    cwd,
    thread,
    images,
    prompt:
      mode === "read"
        ? `Режим только чтение: файлы проекта и домашней папки подключены read-only. Не пытайся их менять. Записывать можно только временные данные и служебную сессию Codex.\n${prompt}`
        : prompt,
  });
  if (mode === "read")
    child.once("close", () => {
      const removal = docker(["rm", "-f", name])
        .catch(() => {})
        .finally(() => workerRemovals.delete(String(uid)));
      workerRemovals.set(String(uid), removal);
    });
  return live;
}

export async function ensureReadWorker(uid, dialogId) {
  await ensureWorker(uid);
  const id = userId(uid),
    name = `ai-read-${id}`;
  // Never bind a tenant-controlled symlink as a privileged host mount.
  for (const p of [
    `${base}/${id}/home`,
    dialogId ? `${base}/${id}/home/dialogs/${dialogId}/.codex` : `${base}/${id}/home/.codex`,
    `${base}/${id}/workspace`,
  ]) {
    if ((await realpath(p)) !== p) throw new Error("Read worker mount must not be a symlink");
  }
  // One global task runs at a time; always create from the current security policy.
  await docker(["rm", "-f", name]).catch(() => {});
  const created = await docker(readWorkerArgs(uid, base, dialogId), { timeout: 120_000 });
  return created.stdout.trim();
}
export async function writeUpload(uid, project, filename, bytes, dialogId) {
  const cwd = await prepareProject(uid, project, dialogId),
    name = await ensureWorker(uid);
  const safe = filename.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-100) || "file";
  const target = `.uploads/${Date.now()}-${safe}`;
  // File writes happen inside the container. Tenant symlinks never resolve on the host.
  const script =
    'import os,sys; p=sys.argv[1]; os.makedirs(".uploads",exist_ok=True); d=os.open(".uploads",os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW); fd=os.open(os.path.basename(p),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=d); f=os.fdopen(fd,"wb"); f.write(sys.stdin.buffer.read()); f.close(); os.close(d)';
  const child = spawn(
    "docker",
    ["exec", "-i", "--workdir", cwd, name, "python3", "-c", script, target],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdin.on("error", () => {});
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (c) =>
      c === 0 ? resolve() : reject(new Error("Не удалось сохранить файл")),
    );
  });
  child.stdin.end(bytes);
  await done;
  return target;
}
export async function readFile(uid, project, filename, dialogId) {
  const cwd = await prepareProject(uid, project, dialogId);
  const target=deliveryPath(cwd,`/app/workspaces/${uid}/AI-bot/User${uid}`,filename);
  const script=await readSource(new URL('./deliver-file.py',import.meta.url),'utf8');
  const result=await runInWorker(uid,['python3','-c',script,target.root,target.name],{encoding:'buffer',maxBuffer:50*1024*1024});
  return result.stdout;
}
export async function listFiles(uid, project, dialogId) {
  const cwd = await prepareProject(uid, project, dialogId);
  const result = await runInWorker(uid, [
    "python3",
    "-c",
    "import os,sys,json; print(json.dumps(sorted(os.listdir(sys.argv[1]))[:100],ensure_ascii=False))",
    cwd,
  ]);
  return JSON.parse(result.stdout);
}

export async function listProjects(uid) {
  const result = await runInWorker(uid, [
    "python3",
    "-c",
    "import os,sys,json;root=sys.argv[1];print(json.dumps(sorted(x for x in os.listdir(root) if not x.startswith('.') and os.path.isdir(os.path.join(root,x)) and not os.path.islink(os.path.join(root,x)))))",
    `/app/workspaces/${userId(uid)}`,
  ]);
  return JSON.parse(result.stdout);
}

export function dialogPaths(uid, id) {
  userId(uid);
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  )
    throw new Error("Invalid dialog ID");
  const home = `/home/agent/dialogs/${id}`;
  return { home, codex: `${home}/.codex`, workspace: `/app/workspaces/${uid}/.dialogs/${id}` };
}
export async function dialogAction(uid, id, action) {
  dialogPaths(uid, id);
  if (action === "erase") {
    const payload = JSON.stringify({ threads: [], complete: false, deleteIds: [id] });
    await runInWorker(
      uid,
      [
        "python3",
        "-c",
        webSyncScript.replace("json.load(sys.stdin)", "json.loads(sys.argv[4])"),
        String(uid),
        "/home/agent",
        `/app/workspaces/${uid}`,
        payload,
      ],
      { timeout: 120000 },
    );
  }
  return runInWorker(uid, ["python3", "-c", dialogScript, action, String(uid), id], {
    timeout: 120_000,
  });
}

export async function removeTenant(uid) {
  const id = userId(uid);
  if (id === "1057399602") throw new Error("Cannot remove owner");
  // The controller first waits for uploads, commands and model tasks to stop.
  await provisioned.get(id)?.catch(() => {});
  await workerRemovals.get(id);
  for (const name of [`ai-read-${id}`, `ai-user-${id}`]) {
    let inspected;
    try {
      inspected = JSON.parse((await docker(["inspect", name])).stdout)[0];
    } catch (error) {
      if (/No such (object|container)/i.test(error.stderr || "")) continue;
      throw error;
    }
    if (inspected.Config.Labels?.["ai-bot.user"] !== id)
      throw new Error("Container ownership mismatch");
    await docker(["rm", "-f", name], { timeout: 120_000 });
  }
  provisioned.delete(id);
  const cleanup = await readSource(new URL("./tenant-files.py", import.meta.url), "utf8");
  for (const root of [base, process.env.AUTH_ROOT || "/opt/ai-bot/auth"])
    await exec("python3", ["-c", cleanup, root, id], { timeout: 600_000, maxBuffer: 16384 });
}

export async function sessionUsage(uid, dialogId, sessionId) {
  if (!sessionId) return normalizeUsage({});
  if (!/^[a-z0-9-]{20,64}$/i.test(sessionId)) throw new Error("Invalid Codex session ID");
  const result = await runInWorker(uid, [
    "python3",
    "-c",
    usageScript,
    dialogPaths(uid, dialogId).codex,
    sessionId,
  ]);
  return normalizeUsage(JSON.parse(result.stdout));
}
