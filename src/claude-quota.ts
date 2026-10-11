import type {DatabaseSync} from 'node:sqlite';

const WEEK = 7 * 86400000;
export const DEFAULT_PERCENT = 10;

/**
 * Личные лимиты Claude.
 *
 * Главный — процент недельного лимита общей подписки (percent), как у GPT.
 * Anthropic не говорит, сколько процентов потратил каждый, поэтому доля
 * человека = недельный процент подписки × его токены / токены всех на ней
 * с начала текущей недели подписки. Токенные лимиты (daily/weekly) остались
 * для старых настроек, в админке их больше не задают.
 */
export function createClaudeQuota(db:DatabaseSync,owner:number){
 db.exec(`CREATE TABLE IF NOT EXISTS claude_user_limits(user_id INTEGER PRIMARY KEY,daily INTEGER,weekly INTEGER,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS claude_web_usage(user_id INTEGER NOT NULL,event_id TEXT NOT NULL,at INTEGER NOT NULL,tokens INTEGER NOT NULL,PRIMARY KEY(user_id,event_id));`);
 if(!(db.prepare('PRAGMA table_info(claude_user_limits)').all() as {name:string}[]).some(c=>c.name==='percent'))db.exec('ALTER TABLE claude_user_limits ADD COLUMN percent REAL');
 const tokensOf=(uid:number|null,since:number)=>Number((uid===null
  ?db.prepare("SELECT coalesce(sum(tokens),0) AS n FROM (SELECT tokens FROM mode_events WHERE engine='claude' AND at>=? UNION ALL SELECT tokens FROM claude_web_usage WHERE at>=?)").get(since,since)
  :db.prepare("SELECT coalesce(sum(tokens),0) AS n FROM (SELECT tokens FROM mode_events WHERE engine='claude' AND user_id=? AND at>=? UNION ALL SELECT tokens FROM claude_web_usage WHERE user_id=? AND at>=?)").get(uid,since,uid,since))!.n);
 /** Недельное окно общей подписки: процент и начало (сброс − 7 дней). */
 function subscriptionWeek(now:number){
  let row:{utilization:number|null;resets_at:number|null}|undefined;
  try{row=db.prepare("SELECT utilization,resets_at FROM rate_limits WHERE limit_type='seven_day' AND (user_id=? OR user_id IN (SELECT user_id FROM allowed_users WHERE added_by=?)) AND user_id NOT IN (SELECT user_id FROM users WHERE api_key_enc IS NOT NULL AND user_id<>?) ORDER BY seen_at DESC LIMIT 1").get(owner,owner,owner) as typeof row;}catch{row=undefined;} // нет таблицы — процент неизвестен
  const resets=row?.resets_at==null?null:row.resets_at<1e12?row.resets_at*1000:row.resets_at;
  if(resets===null||resets<=now)return {utilization:null,start:now-WEEK,resetsAt:null};
  return {utilization:row?.utilization??null,start:resets-WEEK,resetsAt:resets};
 }
 function get(uid:number,now=Date.now()){
  const p=db.prepare('SELECT daily,weekly,percent FROM claude_user_limits WHERE user_id=?').get(uid) as {daily:number|null;weekly:number|null;percent:number|null}|undefined;
  const today=Date.parse(new Date(now).toISOString().slice(0,10));
  const daily={limit:uid===owner?null:p?.daily??null,used:tokensOf(uid,today),resetsAt:today+86400000};
  const weekly={limit:uid===owner?null:p?.weekly??null,used:tokensOf(uid,now-WEEK)};
  const week=subscriptionWeek(now),mine=tokensOf(uid,week.start),all=tokensOf(null,week.start);
  const used=week.utilization===null?null:all>0?Math.round(week.utilization*mine/all*10)/10:0;
  const limit=uid===owner?null:p?.percent??null;
  const subscription={used,limit,resetsAt:week.resetsAt,tokens:mine,exceeded:limit!==null&&used!==null&&used>=limit};
  return {daily,weekly,subscription,exceeded:subscription.exceeded||[daily,weekly].some(w=>w.limit!==null&&w.used>=w.limit)};
 }
 function validate(p:Record<string,unknown>){
  if(Object.keys(p).some(k=>!['daily','weekly','percent'].includes(k)))throw Error('Неизвестный лимит Claude');
  for(const k of ['daily','weekly'])if(p[k]!==undefined&&p[k]!==null&&(!Number.isSafeInteger(p[k])||Number(p[k])<0))throw Error('Лимит — целое число от 0 или пустое поле');
  if(p.percent!==undefined&&p.percent!==null&&(typeof p.percent!=='number'||!Number.isFinite(p.percent)||p.percent<0||p.percent>100))throw Error('Лимит Claude — от 0 до 100% или пустое поле');
 }
 /** Новичкам — 10% недели подписки, как у GPT; уже настроенных не трогаем. */
 function applyDefault(uid:number){
  if(uid===owner||db.prepare('SELECT 1 FROM claude_user_limits WHERE user_id=?').get(uid))return false;
  db.prepare('INSERT INTO claude_user_limits(user_id,daily,weekly,updated_at,percent) VALUES(?,NULL,NULL,?,?)').run(uid,Date.now(),DEFAULT_PERCENT);
  return true;
 }
 return {get,validate,applyDefault,
  set(actor:number,uid:number,patch:Record<string,unknown>){
   if(actor!==owner)throw Error('Только для администратора');
   if(!Number.isSafeInteger(uid)||uid<=0)throw Error('Некорректный пользователь');
   validate(patch);
   if(uid===owner&&Object.values(patch).some(v=>v!==null&&v!==undefined))throw Error('Владелец без личных лимитов');
   const old=get(uid);
   const pick=(k:'daily'|'weekly'|'percent',was:number|null)=>patch[k]===undefined?was:patch[k] as number|null;
   db.prepare('INSERT INTO claude_user_limits(user_id,daily,weekly,updated_at,percent) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET daily=excluded.daily,weekly=excluded.weekly,updated_at=excluded.updated_at,percent=excluded.percent')
    .run(uid,pick('daily',old.daily.limit),pick('weekly',old.weekly.limit),Date.now(),pick('percent',old.subscription.limit));
   return get(uid);
  },
  assert(uid:number){
   const q=get(uid);
   if(q.subscription.exceeded)throw Error(`Достигнут личный лимит Claude: ${q.subscription.used}% из ${q.subscription.limit}% недельной подписки. Лимит может изменить администратор.`);
   if(q.exceeded)throw Error('Достигнут личный лимит Claude. Лимит может изменить администратор.');
  },
  webUsage(uid:number,events:{id:string;at:number;tokens:number}[]){const stmt=db.prepare('INSERT INTO claude_web_usage VALUES(?,?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET tokens=max(tokens,excluded.tokens)');db.exec('BEGIN IMMEDIATE');try{for(const e of events){if(typeof e.id!=='string'||e.id.length>200||!Number.isSafeInteger(e.at)||!Number.isSafeInteger(e.tokens)||e.tokens<0)throw Error('Некорректный расход');stmt.run(uid,e.id,e.at,e.tokens)}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}};
}
