import type {DatabaseSync} from 'node:sqlite';
export function createClaudeQuota(db:DatabaseSync,owner:number){
 db.exec(`CREATE TABLE IF NOT EXISTS claude_user_limits(user_id INTEGER PRIMARY KEY,daily INTEGER,weekly INTEGER,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS claude_web_usage(user_id INTEGER NOT NULL,event_id TEXT NOT NULL,at INTEGER NOT NULL,tokens INTEGER NOT NULL,PRIMARY KEY(user_id,event_id));`);
 function get(uid:number,now=Date.now()){
  const p=db.prepare('SELECT daily,weekly FROM claude_user_limits WHERE user_id=?').get(uid) as {daily:number|null;weekly:number|null}|undefined;
  const used=(since:number)=>Number(db.prepare("SELECT coalesce(sum(tokens),0) AS n FROM (SELECT tokens FROM mode_events WHERE engine='claude' AND user_id=? AND at>=? UNION ALL SELECT tokens FROM claude_web_usage WHERE user_id=? AND at>=?)").get(uid,since,uid,since)!.n);
  const today=Date.parse(new Date(now).toISOString().slice(0,10));
  const daily={limit:uid===owner?null:p?.daily??null,used:used(today),resetsAt:today+86400000};
  const weekly={limit:uid===owner?null:p?.weekly??null,used:used(now-7*86400000)};
  return {daily,weekly,exceeded:[daily,weekly].some(w=>w.limit!==null&&w.used>=w.limit)};
 }
 function validate(p:Record<string,unknown>){if(Object.keys(p).some(k=>!['daily','weekly'].includes(k)))throw Error('Неизвестный лимит Claude');for(const v of Object.values(p))if(v!==null&&(!Number.isSafeInteger(v)||Number(v)<0))throw Error('Лимит — целое число от 0 или пустое поле');}
 return {get,validate,set(actor:number,uid:number,patch:Record<string,unknown>){if(actor!==owner)throw Error('Только для администратора');if(!Number.isSafeInteger(uid)||uid<=0)throw Error('Некорректный пользователь');validate(patch);if(uid===owner&&(patch.daily!==null||patch.weekly!==null))throw Error('Владелец без личных лимитов');const old=get(uid);db.prepare('INSERT INTO claude_user_limits VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET daily=excluded.daily,weekly=excluded.weekly,updated_at=excluded.updated_at').run(uid,patch.daily===undefined?old.daily.limit:patch.daily as number|null,patch.weekly===undefined?old.weekly.limit:patch.weekly as number|null,Date.now());return get(uid)},assert(uid:number){if(get(uid).exceeded)throw Error('Достигнут личный лимит Claude. Лимит может изменить администратор.');},webUsage(uid:number,events:{id:string;at:number;tokens:number}[]){const stmt=db.prepare('INSERT INTO claude_web_usage VALUES(?,?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET tokens=max(tokens,excluded.tokens)');db.exec('BEGIN IMMEDIATE');try{for(const e of events){if(typeof e.id!=='string'||e.id.length>200||!Number.isSafeInteger(e.at)||!Number.isSafeInteger(e.tokens)||e.tokens<0)throw Error('Некорректный расход');stmt.run(uid,e.id,e.at,e.tokens)}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}};
}
