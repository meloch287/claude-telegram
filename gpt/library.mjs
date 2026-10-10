import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dialogRecords, dialogRecord, dialogPath } from '../dist/agent/dialog-workspace.js';
import { workerFor } from '../dist/agent/isolation.js';
import { hideSecrets } from '../dist/agent/render.js';
const execute=promisify(execFile);
const script=await readFile(new URL('./library-files.py',import.meta.url),'utf8');
export function searchHistory(histories, query, engine='all', offset=0) {
  const q=String(query||'').trim().toLocaleLowerCase('ru-RU').slice(0,200);
  if(q.length<2)return {results:[],total:0};
  const results=[];
  for(const h of histories){
    const mode=h.engine==='GPT_BOT'?'gpt':'claude';
    if(engine!=='all'&&engine!==mode)continue;
    const matches=h.messages.filter(m=>String(m.body||'').toLocaleLowerCase('ru-RU').includes(q));
    if(!matches.length&&!h.title.toLocaleLowerCase('ru-RU').includes(q))continue;
    const body=String(matches.at(-1)?.body||h.title),at=body.toLocaleLowerCase('ru-RU').indexOf(q);
    results.push({id:h.id,engine:mode,title:h.title,count:matches.length,excerpt:body.slice(Math.max(0,at-90),Math.max(0,at-90)+360),updated:h.updatedAt});
  }
  return {results:results.slice(offset,offset+20),total:results.length};
}
export function createLibrary({store,workers,teamSpace,busy,submit}) {
  const locks=new Set();
  const chats=uid=>[
    ...store.allThreads(uid).map(r=>({id:'gpt-'+r.id,engine:'gpt',title:r.title,updated:r.updated_at})),
    ...dialogRecords(uid).filter(r=>!r.deleted).map(r=>({id:'claude-'+r.id,engine:'claude',title:r.title||r.project,updated:0})),
  ];
  function own(uid,key){
    const chat=chats(uid).find(c=>c.id===key);if(!chat)throw Error('Диалог недоступен или удалён');
    return {...chat,raw:key.slice(chat.engine.length+1)};
  }
  async function files(uid,key,action,path){
    const chat=own(uid,key), payload=JSON.stringify({action,path});let result;
    if(chat.engine==='gpt'){
      result=await workers.runInWorker(uid,['python3','-c',script,workers.dialogPaths(uid,chat.raw).workspace,payload],{maxBuffer:72*1024*1024,timeout:60000});
    }else{
      const worker=workerFor(uid);
      result=await execute('python3',['-c',script,dialogPath(uid,chat.raw),payload],{uid:worker.uid,gid:worker.gid,env:{PATH:'/usr/bin:/bin',HOME:worker.home},maxBuffer:72*1024*1024,timeout:60000});
    }
    const data=JSON.parse(result.stdout);
    if(data.error)throw Error(data.error.replace(/\[Errno \d+\].*/, 'Папка или файл недоступны'));
    if(action==='zip')data.name=(chat.engine==='gpt'?'GPT':'Claude')+'-'+chat.raw.slice(0,8)+'.zip';
    return data;
  }
  return async (uid,action,body={})=>{
    if(action==='chats')return {chats:chats(uid)};
    if(action==='active')return {dialog:store.activeThread(uid).id,busy:busy(uid)};
    if(action==='open'){
      const chat=own(uid,body.dialog);if(chat.engine!=='gpt')throw Error('Некорректный режим');
      if(busy(uid))throw Error('Дождись завершения текущей задачи или нажми /stop');
      store.selectThread(uid,chat.raw);return {ok:true,title:chat.title};
    }
    if(action==='submit'){
      const chat=own(uid,body.dialog);if(chat.engine!=='gpt')throw Error('Некорректный режим');
      if(busy(uid))throw Error('Дождись завершения текущей задачи или нажми /stop');
      await submit(uid,chat.raw,String(body.text||''),body.images||[]);return {ok:true};
    }
    if(locks.has(uid))throw Error('Предыдущий запрос ещё обрабатывается. Повтори через несколько секунд.');
    locks.add(uid);
    try{
      if(action==='search'){
        const result=searchHistory(await teamSpace.histories(uid),body.query,body.engine,Math.max(0,Number(body.offset)||0));
        // Only registered, owned chats can be opened. Other browser results remain readable.
        const owned=new Set(chats(uid).map(c=>c.id));
        result.results=result.results.map(r=>({...r,openable:owned.has(r.id)}));
        return result;
      }
      if(action==='file-search'){
        const q=String(body.query||'').trim().toLocaleLowerCase('ru-RU').slice(0,200),result=[];let partial=false;
        if(q.length<2)return {results:[],total:0};
        for(const c of chats(uid).filter(c=>body.engine==='all'||!body.engine||c.engine===body.engine)){
          try {const found=await files(uid,c.id,'list');partial ||= found.truncated;
            for(const f of found.files)if(f.path.toLocaleLowerCase('ru-RU').includes(q))result.push({...f,dialog:c.id,title:c.title,engine:c.engine});
          }catch{partial=true;}
        }
        const offset=Math.max(0,Number(body.offset)||0);
        return {results:result.slice(offset,offset+20),total:result.length,partial};
      }
      if(['list','read','zip'].includes(action))return await files(uid,body.dialog,action,body.path);
      throw Error('Неизвестное действие');
    } finally {locks.delete(uid)}
  };
}
