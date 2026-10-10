import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
// Модули бота читают конфиг при импорте: без окружения файл не загружался вовсе.
const dir=mkdtempSync(join(tmpdir(),'team-test-'));
process.env.BOT_TOKEN??='1:test';process.env.ENCRYPTION_KEY??=randomBytes(32).toString('base64');process.env.DATA_DIR??=dir;process.env.WORKSPACE_ROOT??=join(dir,'w');
const {createClaudeQuota}=await import('../dist/claude-quota.js');const {outgoingFiles,deliveryPath}=await import('../dist/bot/delivery.js');
const {createTeamService,validateTeamRequest}=await import('./team-service.mjs');
test('file delivery: markers, old file links, shared files and escape protection',()=>{
 assert.deepEqual(outgoingFiles('Готово\n[[file:отчёт.pdf]]\n[[file:отчёт.pdf]]\n[Картинка](sandbox:/app/test/a.png)'),{visible:'Готово\n\n\n[Картинка](sandbox:/app/test/a.png)',files:['отчёт.pdf','/app/test/a.png']});
 assert.equal(deliveryPath('/a/u','/a/shared','shared:Shared/x.png').path,'/a/shared/Shared/x.png');
 for(const p of ['../other/secret','/a/other/x','shared:.ai-team.json','shared:Shared/../../x','x//z'])assert.throws(()=>deliveryPath('/a/u','/a/shared',p));
});
test('Claude budget: isolated daily/week limits and unique bb usage',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mode_events(engine TEXT,user_id INTEGER,at INTEGER,tokens INTEGER)');const q=createClaudeQuota(db,1);
 assert.throws(()=>q.set(2,3,{daily:10}),/администратора/);
 for(const v of [-1,1.2,'10',NaN])assert.throws(()=>q.set(1,2,{daily:v}));
 q.set(1,2,{daily:100,weekly:200});q.webUsage(2,[{id:'m1',at:Date.now(),tokens:100}]);q.webUsage(2,[{id:'m1',at:Date.now(),tokens:100}]);
 assert.equal(q.get(2).daily.used,100);assert.throws(()=>q.assert(2),/лимит/);q.assert(3);q.assert(1);
 q.set(1,2,{daily:null,weekly:null});q.assert(2);q.set(1,2,{daily:0});assert.throws(()=>q.assert(2));db.close();
});
const make=(patch={})=>createTeamService({allowed:uid=>[1,2].includes(uid),guard:async()=>{},space:{prepare:async()=>{},refresh:async uid=>[{id:'gpt-'+uid,engine:'GPT_BOT',messages:[{role:'user',body:'own',at:0}]}],histories:async uid=>[{id:'gpt-'+uid,engine:'GPT_BOT',messages:[]}],note:async()=>{}},consultGPT:async()=>({answer:'совет'}),...patch});
test('history and consultation never read another user chat',async()=>{
 const s=make();await assert.rejects(s.call(3,{op:'history'}));await assert.rejects(s.call(1,{op:'history',chat:'gpt-2'}));await assert.rejects(s.call(1,{op:'ask',engine:'gpt',prompt:'test',chat:'gpt-2'}));assert.equal((await s.call(1,{op:'history',chat:'gpt-1'})).messages[0].body,'own');
});
test('consultations: cancellation, busy guard, cleanup and proxy guard failure',async()=>{
 let finish;const s=make({consultGPT:({signal})=>new Promise((resolve,reject)=>{finish=()=>resolve({answer:'x'});signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true})})});
 const first=s.call(1,{op:'ask',engine:'gpt',prompt:'test'});await new Promise(r=>setImmediate(r));await assert.rejects(s.call(1,{op:'ask',engine:'gpt',prompt:'test'}),/выполняется/);s.cancel(1);await assert.rejects(first,/stopped/);assert.equal((await s.call(1,{op:'status'})).busy,false);
 const guarded=make({guard:async()=>{throw Error('proxy down')},consultGPT:async()=>assert.fail('must not call model')});await assert.rejects(guarded.call(1,{op:'ask',engine:'gpt',prompt:'test'}),/proxy down/);
});
test('strict payload rejects user overrides and malformed operations',()=>{for(const b of [{op:'ask',engine:'gpt',prompt:'a',uid:2},{op:'image',prompt:''},{op:'history',history_engine:'bogus'},{op:'history',offset:-1}])assert.throws(()=>validateTeamRequest(b))});
