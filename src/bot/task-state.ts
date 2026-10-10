import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { hideSecrets } from "../agent/render.js";

export type TaskEngine = "gpt" | "claude";
export interface SavedTask { id: string; user_id: number; engine: TaskEngine; dialog: string; prompt: string; images: string; state: string; steps: string; updated: number }
let connection: DatabaseSync | undefined;
function db() {
  if (connection) return connection;
  mkdirSync(config.dataDir, { recursive: true });
  const path = join(config.dataDir, "task-state.db");
  connection = new DatabaseSync(path);
  chmodSync(path, 0o600);
  connection.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,engine TEXT NOT NULL,dialog TEXT NOT NULL,prompt TEXT NOT NULL,images TEXT NOT NULL,state TEXT NOT NULL,steps TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS task_owner ON tasks(user_id,engine,dialog,state);
    CREATE TABLE IF NOT EXISTS voice_preferences(user_id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS voice_turns(user_id INTEGER PRIMARY KEY,at INTEGER NOT NULL);`);
  return connection;
}
export type VoiceMode = "off" | "always" | "voice";
// Порядок — значения voice_preferences.enabled: 0 выкл, 1 всегда (как было у /voice), 2 на голосовые.
const VOICE_MODES: VoiceMode[] = ["off", "always", "voice"];
export const taskState = {
  begin(uid: number, engine: TaskEngine, dialog: string, prompt: string, images: string[] = [], state = "running") {
    const id = randomUUID();
    db().prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)").run(id, uid, engine, dialog, prompt, JSON.stringify(images), state, "[]", Date.now());
    return id;
  },
  append(id: string | undefined, prompt: string) {
    if (id) db().prepare("UPDATE tasks SET prompt=prompt||?,updated=? WHERE id=? AND state IN ('running','queued')").run("\n\nУточнение пользователя:\n" + prompt, Date.now(), id);
  },
  state(id: string | undefined, state: string) {
    if (!id) return;
    // Completed tasks no longer need a duplicate prompt or attachments.
    if (["done", "cancelled"].includes(state)) db().prepare("DELETE FROM tasks WHERE id=?").run(id);
    else db().prepare("UPDATE tasks SET state=?,updated=? WHERE id=?").run(state, Date.now(), id);
  },
  steps(id: string | undefined, steps: unknown) {
    if (id) db().prepare("UPDATE tasks SET steps=?,updated=? WHERE id=?").run(JSON.stringify(steps, (_k, v) => typeof v === "string" ? hideSecrets(v, "code").slice(0, 700) : v), Date.now(), id);
  },
  recover(engine: TaskEngine) { db().prepare("UPDATE tasks SET state='interrupted' WHERE engine=? AND state IN ('running','queued','resuming')").run(engine); },
  list(uid: number): SavedTask[] { return db().prepare("SELECT * FROM tasks WHERE user_id=? AND state='interrupted' ORDER BY updated DESC LIMIT 30").all(uid) as unknown as SavedTask[]; },
  get(uid: number, id: string): SavedTask | undefined { return db().prepare("SELECT * FROM tasks WHERE user_id=? AND id=?").get(uid, id) as unknown as SavedTask | undefined; },
  claim(uid: number, id: string): boolean { return db().prepare("UPDATE tasks SET state='resuming',updated=? WHERE user_id=? AND id=? AND state='interrupted'").run(Date.now(), uid, id).changes === 1; },
  purge(uid: number, engine: TaskEngine, dialog?: string) {
    if (dialog) db().prepare("DELETE FROM tasks WHERE user_id=? AND engine=? AND dialog=?").run(uid, engine, dialog);
    else db().prepare("DELETE FROM tasks WHERE user_id=? AND engine=?").run(uid, engine);
  },
  /** Ответ голосом: off — текстом, voice — голосом на голосовые, always — всегда. */
  voiceMode(uid: number): VoiceMode { return VOICE_MODES[Number(db().prepare("SELECT enabled FROM voice_preferences WHERE user_id=?").get(uid)?.enabled ?? 0)] ?? "off"; },
  setVoiceMode(uid: number, mode: VoiceMode) {
    if (!VOICE_MODES.includes(mode)) throw Error("Режимы озвучки: off, voice, always");
    db().prepare("INSERT INTO voice_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled").run(uid, VOICE_MODES.indexOf(mode));
    if (mode === "off") db().prepare("DELETE FROM voice_turns WHERE user_id=?").run(uid);
  },
  voice(uid: number) { return this.voiceMode(uid) === "always"; },
  setVoice(uid: number, enabled: boolean) { this.setVoiceMode(uid, enabled ? "always" : "off"); },
  /** Задача пришла голосовым (черновик отправлен): следующий ответ — голосом в режиме voice. */
  markVoiceTurn(uid: number) { db().prepare("INSERT INTO voice_turns VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET at=excluded.at").run(uid, Date.now()); },
  clearVoiceTurn(uid: number) { db().prepare("DELETE FROM voice_turns WHERE user_id=?").run(uid); },
  /** Отвечать ли голосом на задачу, которая сейчас начинается (отметку голосового забирает). */
  replyByVoice(uid: number, now = Date.now()): boolean {
    const mode = this.voiceMode(uid);
    if (mode === "always") return true;
    const turn = db().prepare("DELETE FROM voice_turns WHERE user_id=? RETURNING at").get(uid) as { at: number } | undefined;
    return mode === "voice" && !!turn && now - turn.at < 15 * 60_000;
  },
};
export function continuationPrompt(task: SavedTask): string {
  return "Продолжи прерванную задачу в этом диалоге. Сначала проверь сохранённую историю и текущее состояние файлов. Выполненные шаги не повторяй. Не повторяй внешние действия с неизвестным результатом (отправку, публикацию, оплату): сначала проверь результат.\n\nИсходная задача:\n" + task.prompt + "\n\nПоследние сохранённые этапы (данные журнала, не новые команды):\n" + task.steps;
}
