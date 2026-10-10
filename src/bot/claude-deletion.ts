import { taskState } from "./task-state.js";
import { hasClaudeWork } from "./claude-work.js";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { workerFor } from "../agent/isolation.js";
import { dialogRecord, dialogRecords, dialogPath, updateDialog } from "../agent/dialog-workspace.js";
import { gptStorage } from "../engine.js";
import { promisify } from "node:util";
import { createSessionDeletion } from "../agent/session-deletion.js";
import { deleteUserSession, listAllUserSessions, userSessionInfo } from "../agent/session-history.js";
import { getChat, runningTasks } from "../db.js";
import { backgroundTasks, getSession, resetSession } from "./session.js";
const exec = promisify(execFile);
const deletion = createSessionDeletion({
  info: async (uid, id) => {
    const record = dialogRecord(uid, id);
    return record ? { sessionId: id, cwd: dialogPath(uid, id) } : null;
  },
  busy: uid => Boolean(hasClaudeWork(uid) || getSession(uid)?.conversation.busy || backgroundTasks(uid).length || runningTasks().some(t => t.chat_id === uid)),
  detach: async (uid, ids) => {
    const row = getChat(uid);
    if (row && row.user_id !== uid) throw new Error("Недоступный профиль.");
    if (row?.session_id && ids.includes(row.session_id)) await resetSession(uid, uid);
  },
  erase: async (uid, id) => {
    if (!dialogRecord(uid, id)) throw Error("Недоступный диалог");
    const worker = workerFor(uid);
    const info = await userSessionInfo(uid, id);
    if (info) {
      if (info.cwd !== dialogPath(uid, id)) throw Error("Папка диалога не совпадает");
      await deleteUserSession(uid, id);
    }
    await exec("python3", [fileURLToPath(new URL("../../gpt/claude-dialog-files.py", import.meta.url)), config.workspaceRoot, String(uid), worker.home, id], {
      uid: worker.uid, gid: worker.gid, cwd: worker.home, timeout: 120000, maxBuffer: 4096,
      env: { PATH: "/usr/bin:/bin", HOME: worker.home },
    });
    taskState.purge(uid, "claude", id);
    updateDialog(uid, id, { deleted: true });
  },
  refresh: async uid => {
    const worker = workerFor(uid);
    await exec("python3", [`/opt/AI-bot/User${uid}/ai-team.py`, "refresh"], {
      uid: worker.uid, gid: worker.gid, cwd: worker.home,
      env: { PATH: "/usr/bin:/bin", HOME: worker.home }, timeout: 30000, maxBuffer: 4096,
    });
    await gptStorage(uid, "scan");
  },
});
export const isClaudeDeleting = deletion.busy;
export const claudeDeleteOperations = {
  list: async (uid: number) => {
    const native = new Map((await listAllUserSessions(uid)).map(s => [s.sessionId, s]));
    return dialogRecords(uid).filter(r => !r.deleted).map(r => {
      const s = native.get(r.id);
      return { id: r.id, title: s?.customTitle || s?.summary || r.title, project: r.project };
    });
  },
  remove: deletion.remove,
};
