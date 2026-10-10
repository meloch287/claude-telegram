import type { DatabaseSync } from "node:sqlite";
export type Mode = "gpt" | "claude";
export interface ModeStats {
 total_tokens: number; total_cost_usd: number; total_messages: number; total_sessions: number;
 tools_allowed: number; tools_denied: number; history_tokens: number; history_messages: number;
 streak_days: number; last_active_day: string | null;
}
const dayAt = (at = Date.now()) => new Date(at).toISOString().slice(0,10);
export function initializeModeData(db: DatabaseSync): void {
 db.exec("PRAGMA busy_timeout=5000");
 db.exec(`
CREATE TABLE IF NOT EXISTS mode_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mode_legacy_stats(user_id INTEGER PRIMARY KEY,unassigned_messages INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mode_stats(engine TEXT NOT NULL,user_id INTEGER NOT NULL,total_tokens INTEGER NOT NULL DEFAULT 0,total_cost_usd REAL NOT NULL DEFAULT 0,total_messages INTEGER NOT NULL DEFAULT 0,total_sessions INTEGER NOT NULL DEFAULT 0,tools_allowed INTEGER NOT NULL DEFAULT 0,tools_denied INTEGER NOT NULL DEFAULT 0,history_tokens INTEGER NOT NULL DEFAULT 0,history_messages INTEGER NOT NULL DEFAULT 0,streak_days INTEGER NOT NULL DEFAULT 0,last_active_day TEXT,PRIMARY KEY(engine,user_id));
CREATE TABLE IF NOT EXISTS mode_daily(engine TEXT NOT NULL,user_id INTEGER NOT NULL,day TEXT NOT NULL,tokens INTEGER NOT NULL DEFAULT 0,cost_usd REAL NOT NULL DEFAULT 0,PRIMARY KEY(engine,user_id,day));
CREATE TABLE IF NOT EXISTS mode_events(engine TEXT NOT NULL,user_id INTEGER NOT NULL,at INTEGER NOT NULL,tokens INTEGER NOT NULL,cost_usd REAL NOT NULL);
CREATE INDEX IF NOT EXISTS mode_events_user ON mode_events(engine,user_id,at);
CREATE TABLE IF NOT EXISTS mode_achievements(engine TEXT NOT NULL,user_id INTEGER NOT NULL,achievement TEXT NOT NULL,unlocked_at INTEGER NOT NULL,PRIMARY KEY(engine,user_id,achievement));
CREATE TABLE IF NOT EXISTS mode_projects(engine TEXT NOT NULL,user_id INTEGER NOT NULL,project TEXT NOT NULL,PRIMARY KEY(engine,user_id,project));
CREATE TABLE IF NOT EXISTS mode_world_scores (
 engine TEXT NOT NULL,  user_id INTEGER NOT NULL,
  score      INTEGER NOT NULL,
  pop        INTEGER NOT NULL DEFAULT 0,
  day        INTEGER NOT NULL DEFAULT 1,
  era        INTEGER NOT NULL DEFAULT 0,
  seed       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
 PRIMARY KEY(engine,user_id)
);
CREATE TABLE IF NOT EXISTS mode_world_saves (
 engine TEXT NOT NULL,  user_id    INTEGER NOT NULL,
  key        TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (engine, user_id, key)
);
CREATE TABLE IF NOT EXISTS mode_world_work (
 engine TEXT NOT NULL,  user_id INTEGER NOT NULL,
  tasks           INTEGER NOT NULL DEFAULT 0,
  commits         INTEGER NOT NULL DEFAULT 0,
  pushes          INTEGER NOT NULL DEFAULT 0,
  claimed_tasks   INTEGER NOT NULL DEFAULT 0,
  claimed_commits INTEGER NOT NULL DEFAULT 0,
  claimed_pushes  INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(engine,user_id)
);
CREATE TABLE IF NOT EXISTS mode_world_inbox (
 engine TEXT NOT NULL,  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  from_user  INTEGER NOT NULL,
  amount     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mode_world_sends (
 engine TEXT NOT NULL,  from_user INTEGER NOT NULL,
  to_user   INTEGER NOT NULL,
  kind      TEXT NOT NULL,
  at        INTEGER NOT NULL
);
 `);
 if(db.prepare("SELECT 1 FROM mode_meta WHERE key='split-v1'").get())return;
 const exists=(name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
 db.exec("BEGIN IMMEDIATE");
 try {
  if(db.prepare("SELECT 1 FROM mode_meta WHERE key='split-v1'").get()){db.exec("COMMIT");return;}
  if(exists('users')){
   const users=db.prepare('SELECT * FROM users').all() as unknown as Array<ModeStats & {user_id:number}>;
   for(const u of users){
    db.prepare("INSERT OR IGNORE INTO mode_legacy_stats VALUES(?,?)").run(u.user_id,Math.max(0,u.total_messages-u.history_messages));
    const gpt=exists('gpt_meter_events') ? Number((db.prepare('SELECT COALESCE(SUM(input_tokens+output_tokens),0) n FROM gpt_meter_events WHERE user_id=?').get(u.user_id) as {n:number}).n) : 0;
    db.prepare("INSERT OR IGNORE INTO mode_stats(engine,user_id,total_tokens) VALUES('gpt',?,?)").run(u.user_id,gpt);
    db.prepare("INSERT OR IGNORE INTO mode_stats(engine,user_id,total_tokens,total_cost_usd,total_messages,total_sessions,tools_allowed,tools_denied,history_tokens,history_messages,streak_days,last_active_day) VALUES('claude',?,?,?,?,?,?,?,?,?,?,?)").run(u.user_id,Math.max(0,u.total_tokens-gpt),u.total_cost_usd,u.history_messages,u.total_sessions,u.tools_allowed,u.tools_denied,u.history_tokens,u.history_messages,u.streak_days,u.last_active_day);
   }
  }
  if(exists('gpt_meter_events')){
   db.exec("INSERT INTO mode_daily SELECT 'gpt',user_id,strftime('%Y-%m-%d',at/1000,'unixepoch'),SUM(input_tokens+output_tokens),0 FROM gpt_meter_events GROUP BY user_id,strftime('%Y-%m-%d',at/1000,'unixepoch')");
   db.exec("INSERT INTO mode_events SELECT 'gpt',user_id,at,input_tokens+output_tokens,0 FROM gpt_meter_events");
  }
  if(exists('usage_daily'))db.exec("INSERT INTO mode_daily SELECT 'claude',d.user_id,d.day,MAX(0,d.tokens-COALESCE(g.tokens,0)),d.cost_usd FROM usage_daily d LEFT JOIN mode_daily g ON g.engine='gpt' AND g.user_id=d.user_id AND g.day=d.day");
  if(exists('usage_events'))db.exec("INSERT INTO mode_events SELECT 'claude',u.user_id,u.at,u.tokens,u.cost_usd FROM usage_events u WHERE NOT EXISTS(SELECT 1 FROM mode_events g WHERE g.engine='gpt' AND g.user_id=u.user_id AND g.at=u.at AND g.tokens=u.tokens AND u.cost_usd=0)");
  if(exists('achievements'))db.exec("INSERT INTO mode_achievements SELECT 'claude',user_id,achievement,unlocked_at FROM achievements");
  if(exists('projects_seen'))db.exec("INSERT INTO mode_projects SELECT 'claude',user_id,project FROM projects_seen");
  for(const table of ['world_scores','world_saves','world_work','world_inbox','world_sends']){
   if(!exists(table))continue;
   const columns=(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name).join(',');
   db.exec(`INSERT INTO mode_${table}(engine,${columns}) SELECT 'gpt',${columns} FROM ${table}`);
  }
  db.prepare("INSERT INTO mode_meta(key,value) VALUES('split-v1',?)").run(String(Date.now()));db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function createModeData(db: DatabaseSync, engine: Mode){
 if(engine!=='gpt'&&engine!=='claude')throw Error('Неизвестный режим');
 const prepare=(sql:string)=>db.prepare(sql.replaceAll('$ENGINE',`'${engine}'`));
 const lazy=(sql:string)=>{let statement:ReturnType<DatabaseSync["prepare"]>|undefined;const ready=()=>statement??=prepare(sql);return {get:(...args:any[])=>ready().get(...args),all:(...args:any[])=>ready().all(...args),run:(...args:any[])=>ready().run(...args)}};
 const stmts={
 upsertWorldScore: lazy("INSERT INTO mode_world_scores(engine,user_id,score,pop,day,era,seed,updated_at) VALUES($ENGINE,?,?,?,?,?,?,?) ON CONFLICT(engine,user_id) DO UPDATE SET score=excluded.score,pop=excluded.pop,day=excluded.day,era=excluded.era,seed=excluded.seed,updated_at=excluded.updated_at"),
 topWorlds: lazy("SELECT w.user_id,w.score,w.pop,w.day,w.era,w.seed,u.display_name FROM mode_world_scores w LEFT JOIN users u ON u.user_id=w.user_id WHERE w.engine=$ENGINE ORDER BY w.score DESC LIMIT ?"),
 worldRank: lazy("SELECT COUNT(*)+1 rank FROM mode_world_scores WHERE engine=$ENGINE AND score>(SELECT score FROM mode_world_scores WHERE engine=$ENGINE AND user_id=?)"),
 listWorldSaves: lazy("SELECT key,data,updated_at FROM mode_world_saves WHERE engine=$ENGINE AND user_id=? ORDER BY key"),
 putWorldSave: lazy("INSERT INTO mode_world_saves(engine,user_id,key,data,updated_at) VALUES($ENGINE,?,?,?,?) ON CONFLICT(engine,user_id,key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at"),
 deleteWorldSave: lazy("DELETE FROM mode_world_saves WHERE engine=$ENGINE AND user_id=? AND key=?"),
 hasWorldSave: lazy("SELECT 1 FROM mode_world_saves WHERE engine=$ENGINE AND user_id=? AND key=?"),
 countWorldSaves: lazy("SELECT COUNT(*) n FROM mode_world_saves WHERE engine=$ENGINE AND user_id=?"),
 addWorldWork: lazy("INSERT INTO mode_world_work(engine,user_id,tasks,commits,pushes) VALUES($ENGINE,?,?,?,?) ON CONFLICT(engine,user_id) DO UPDATE SET tasks=tasks+excluded.tasks,commits=commits+excluded.commits,pushes=pushes+excluded.pushes"),
 getWorldWork: lazy("SELECT * FROM mode_world_work WHERE engine=$ENGINE AND user_id=?"),
 claimWorldWork: lazy("UPDATE mode_world_work SET claimed_tasks=tasks,claimed_commits=commits,claimed_pushes=pushes WHERE engine=$ENGINE AND user_id=?"),
 listInbox: lazy("SELECT i.id,i.kind,i.from_user,i.amount,i.created_at,u.display_name FROM mode_world_inbox i LEFT JOIN users u ON u.user_id=i.from_user WHERE i.engine=$ENGINE AND i.user_id=? ORDER BY i.id"),
 clearInbox: lazy("DELETE FROM mode_world_inbox WHERE engine=$ENGINE AND user_id=?"),
 addInbox: lazy("INSERT INTO mode_world_inbox(engine,user_id,kind,from_user,amount,created_at) VALUES($ENGINE,?,?,?,?,?)"),
 addSend: lazy("INSERT INTO mode_world_sends(engine,from_user,to_user,kind,at) VALUES($ENGINE,?,?,?,?)"),
 sendsSince: lazy("SELECT to_user,kind FROM mode_world_sends WHERE engine=$ENGINE AND from_user=? AND at>?"),
 pruneSends: lazy("DELETE FROM mode_world_sends WHERE engine=$ENGINE AND at<?")
};
 const ensure=(uid:number)=>{prepare("INSERT OR IGNORE INTO mode_stats(engine,user_id) VALUES($ENGINE,?)").run(uid)};
 const stats=(uid:number):ModeStats=>{ensure(uid);return prepare("SELECT * FROM mode_stats WHERE engine=$ENGINE AND user_id=?").get(uid) as unknown as ModeStats};
 function bump(uid:number,field:'total_messages'|'total_sessions'|'tools_allowed'|'tools_denied',amount=1){ensure(uid);prepare(`UPDATE mode_stats SET ${field}=${field}+? WHERE engine=$ENGINE AND user_id=?`).run(amount,uid)}
 function usage(uid:number,tokens:number,cost:number,at=Date.now()){
  ensure(uid);prepare("UPDATE mode_stats SET total_tokens=total_tokens+?,total_cost_usd=total_cost_usd+? WHERE engine=$ENGINE AND user_id=?").run(tokens,cost,uid);
  prepare("INSERT INTO mode_daily(engine,user_id,day,tokens,cost_usd) VALUES($ENGINE,?,?,?,?) ON CONFLICT(engine,user_id,day) DO UPDATE SET tokens=tokens+excluded.tokens,cost_usd=cost_usd+excluded.cost_usd").run(uid,dayAt(at),tokens,cost);
  if(tokens>0||cost>0)prepare("INSERT INTO mode_events(engine,user_id,at,tokens,cost_usd) VALUES($ENGINE,?,?,?,?)").run(uid,at,tokens,cost);
 }
 function history(uid:number,tokens:number,messages:number){ensure(uid);prepare("UPDATE mode_stats SET total_tokens=total_tokens+?,history_tokens=history_tokens+?,total_messages=total_messages+?,history_messages=history_messages+? WHERE engine=$ENGINE AND user_id=?").run(tokens,tokens,messages,messages,uid)}
 function daily(uid:number,days=14){const result=[];for(let i=days-1;i>=0;i--){const day=dayAt(Date.now()-i*86400000);const row=prepare("SELECT tokens,cost_usd FROM mode_daily WHERE engine=$ENGINE AND user_id=? AND day=?").get(uid,day) as {tokens:number;cost_usd:number}|undefined;result.push({day,tokens:row?.tokens??0,costUsd:row?.cost_usd??0})}return result}
 function since(uid:number,windowMs:number){const row=prepare("SELECT COALESCE(SUM(tokens),0) tokens,COALESCE(SUM(cost_usd),0) costUsd FROM mode_events WHERE engine=$ENGINE AND user_id=? AND at>=?").get(uid,Date.now()-windowMs) as {tokens:number;costUsd:number};return row}
 function unlock(uid:number,id:string){return !!prepare("INSERT OR IGNORE INTO mode_achievements(engine,user_id,achievement,unlocked_at) VALUES($ENGINE,?,?,?)").run(uid,id,Date.now()).changes}
 function achievements(uid:number){return prepare("SELECT achievement,unlocked_at FROM mode_achievements WHERE engine=$ENGINE AND user_id=?").all(uid) as unknown as {achievement:string;unlocked_at:number}[]}
 function project(uid:number,name:string){prepare("INSERT OR IGNORE INTO mode_projects(engine,user_id,project) VALUES($ENGINE,?,?)").run(uid,name);return (prepare("SELECT COUNT(*) n FROM mode_projects WHERE engine=$ENGINE AND user_id=?").get(uid) as {n:number}).n}
 function streak(uid:number){const row=stats(uid),day=dayAt();if(row.last_active_day===day)return row.streak_days;const n=row.last_active_day===dayAt(Date.now()-86400000)?row.streak_days+1:1;prepare("UPDATE mode_stats SET last_active_day=?,streak_days=? WHERE engine=$ENGINE AND user_id=?").run(day,n,uid);return n}
function recordWorldScore(
  userId: number,
  s: { score: number; pop: number; day: number; era: number; seed: number },
): void {
  stmts.upsertWorldScore.run(
    userId,
    Math.max(0, Math.floor(s.score)),
    s.pop | 0,
    s.day | 0,
    s.era | 0,
    s.seed | 0,
    Date.now(),
  );
}
function topWorlds(limit = 10): Array<{
  user_id: number;
  score: number;
  pop: number;
  day: number;
  era: number;
  seed: number;
  display_name: string | null;
}> {
  return stmts.topWorlds.all(limit) as never;
}
function worldRank(userId: number): number | null {
  const row = stmts.worldRank.get(userId) as { rank: number } | undefined;
  if (!row) return null;
  const has = (stmts.topWorlds.all(1000) as Array<{ user_id: number }>).some(
    (r) => r.user_id === userId,
  );
  return has ? row.rank : null;
}

/**
 * Облачная копия мира. Ключ — тот же, что в localStorage мини-аппа (world:*),
 * данные — та же строка. Метка времени серверная: по ней клиент понимает,
 * менял ли остров кто-то другой с последней синхронизации, и часы телефонов
 * в этом не участвуют.
 */
const WORLD_SAVE_KEY = /^world:[A-Za-z0-9:_.-]{1,96}$/;
const WORLD_SAVE_MAX_BYTES = 512 * 1024;
const WORLD_SAVE_MAX_KEYS = 64;

type WorldSave = { key: string; data: string; updatedAt: number };

function listWorldSaves(userId: number): WorldSave[] {
  const rows = stmts.listWorldSaves.all(userId) as {
    key: string;
    data: string;
    updated_at: number;
  }[];
  return rows.map((r) => ({ key: r.key, data: r.data, updatedAt: r.updated_at }));
}

/**
 * Записать снимок. Возвращает метку, которую клиент запомнит как «общую»,
 * или причину отказа: чужой ключ, слишком большой снимок, слишком много ключей.
 */
function putWorldSave(
  userId: number,
  key: string,
  data: string,
): { updatedAt: number } | { error: "key" | "size" | "limit" } {
  if (!WORLD_SAVE_KEY.test(key)) return { error: "key" };
  if (Buffer.byteLength(data) > WORLD_SAVE_MAX_BYTES) return { error: "size" };
  const known = stmts.hasWorldSave.get(userId, key) !== undefined;
  const count = (stmts.countWorldSaves.get(userId) as { n: number }).n;
  if (!known && count >= WORLD_SAVE_MAX_KEYS) return { error: "limit" };
  const updatedAt = Date.now();
  stmts.putWorldSave.run(userId, key, data, updatedAt);
  return { updatedAt };
}

function deleteWorldSave(userId: number, key: string): void {
  stmts.deleteWorldSave.run(userId, key);
}

/** Работа в боте, которая дойдёт до острова: законченная задача, коммит, пуш. */
function recordWorldWork(
  userId: number,
  work: { tasks?: number; commits?: number; pushes?: number },
): void {
  const tasks = Math.max(0, work.tasks ?? 0);
  const commits = Math.max(0, work.commits ?? 0);
  const pushes = Math.max(0, work.pushes ?? 0);
  if (!tasks && !commits && !pushes) return;
  stmts.addWorldWork.run(userId, tasks, commits, pushes);
}

type WorldClaim = {
  work: { tasks: number; commits: number; pushes: number; totalCommits: number };
  inbox: { kind: string; fromUser: number; fromName: string | null; amount: number; at: number }[];
};

/**
 * Забрать всё, что ждёт остров, и сразу пометить выданным — одной транзакцией.
 * Лучше потерять награду, если телефон упадёт посреди применения, чем
 * выдать её дважды при повторном открытии.
 */
function claimWorld(userId: number): WorldClaim {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = stmts.getWorldWork.get(userId) as
      | {
          tasks: number;
          commits: number;
          pushes: number;
          claimed_tasks: number;
          claimed_commits: number;
          claimed_pushes: number;
        }
      | undefined;
    const rows = stmts.listInbox.all(userId) as {
      kind: string;
      from_user: number;
      amount: number;
      created_at: number;
      display_name: string | null;
    }[];
    stmts.claimWorldWork.run(userId);
    stmts.clearInbox.run(userId);
    db.exec("COMMIT");
    return {
      work: {
        tasks: row ? row.tasks - row.claimed_tasks : 0,
        commits: row ? row.commits - row.claimed_commits : 0,
        pushes: row ? row.pushes - row.claimed_pushes : 0,
        totalCommits: row?.commits ?? 0,
      },
      inbox: rows.map((r) => ({
        kind: r.kind,
        fromUser: r.from_user,
        fromName: r.display_name,
        amount: r.amount,
        at: r.created_at,
      })),
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const WORLD_SEND_KINDS = ["gift", "raid"] as const;
type WorldSendKind = (typeof WORLD_SEND_KINDS)[number];
/** Сутки: один подарок и один набег одному острову, всего набегов — пять. */
const SEND_WINDOW_MS = 24 * 3600 * 1000;
const RAIDS_PER_DAY = 5;

/** Подарок или набег на чужой остров. Доходит, когда хозяин откроет мир. */
function sendToWorld(
  fromUser: number,
  toUser: number,
  kind: WorldSendKind,
  amount: number,
): { ok: true } | { error: "self" | "again" | "limit" } {
  if (fromUser === toUser) return { error: "self" };
  const now = Date.now();
  stmts.pruneSends.run(now - SEND_WINDOW_MS);
  const recent = stmts.sendsSince.all(fromUser, now - SEND_WINDOW_MS) as {
    to_user: number;
    kind: string;
  }[];
  if (recent.some((r) => r.to_user === toUser && r.kind === kind)) return { error: "again" };
  if (kind === "raid" && recent.filter((r) => r.kind === "raid").length >= RAIDS_PER_DAY)
    return { error: "limit" };
  stmts.addSend.run(fromUser, toUser, kind, now);
  stmts.addInbox.run(toUser, kind, fromUser, Math.max(1, Math.min(5, Math.floor(amount))), now);
  return { ok: true };
}


 return {stats,bump,usage,history,daily,since,unlock,achievements,project,streak,recordWorldScore,topWorlds,worldRank,listWorldSaves,putWorldSave,deleteWorldSave,recordWorldWork,claimWorld,sendToWorld};
}
