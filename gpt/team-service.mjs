import {randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createTeamSpace,teamRoot} from './team-space.mjs';import {gptConsult,claudeConsult,gptImage} from './team-providers.mjs';import {effectiveEffort} from './reasoning.mjs';
const exec=promisify(execFile);const engineName=x=>x==='claude'?'Claude_BOT':'GPT_BOT';
export function validateTeamRequest(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['op','engine','prompt','chat','history_engine','offset','limit','source'].includes(k)))throw Error('Некорректный запрос');
 if(!['history','ask','image','refresh','status','cancel'].includes(body.op))throw Error('Неизвестное действие');
 if(body.source!==undefined&&!['gpt','claude'].includes(body.source))throw Error('Неизвестный режим');
 if(body.op==='ask'&&!['gpt','claude'].includes(body.engine))throw Error('Выбери GPT или Claude');
 if(body.op==='history'&&body.engine!==undefined&&!['gpt','claude','all'].includes(body.engine))throw Error('Неизвестный режим истории');
 if(body.history_engine!==undefined&&!['gpt','claude'].includes(body.history_engine))throw Error('Неизвестный режим истории');
 if(body.chat!==undefined&&body.chat!==null&&(typeof body.chat!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(body.chat)))throw Error('Некорректный диалог');
 if(['ask','image'].includes(body.op)&&(typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>64000))throw Error('Вопрос должен быть от 1 до 64000 символов');
 for(const [k,max] of [['offset',1000000],['limit',500]])if(body[k]!==undefined&&(!Number.isSafeInteger(body[k])||body[k]<0||body[k]>max))throw Error('Некорректная страница истории');
 return body;
}
export function createTeamService({space,allowed,before=async()=>({}),after=async()=>{},charge=()=>{},models=()=> 'gpt-6-sol',guard=()=>exec('/usr/local/libexec/ai-bot-proxy/guard-health',[],{timeout:20000,maxBuffer:2048}),consultGPT=gptConsult,consultClaude=claudeConsult,imageGPT=gptImage}){
 const busy=new Map();const cancel=uid=>busy.get(uid)?.abort.abort();
 async function call(uid,body,signal){if(!allowed(uid))throw Error('Нет доступа');validateTeamRequest(body);
  if(body.op==='cancel'){cancel(uid);return {cancelled:true}}
  if(body.op==='status')return {busy:busy.has(uid),root:teamRoot(uid,body.source==='claude')};
  if(['history','refresh'].includes(body.op)){const chats=await space.refresh(uid);if(body.op==='refresh')return {updated:true,chats:chats.length,root:teamRoot(uid,body.source==='claude')};const filtered=chats.filter(c=>!body.engine||body.engine==='all'||c.engine===engineName(body.engine));if(!body.chat)return {chats:filtered.map(({messages,...c})=>({...c,messageCount:messages.length}))};const chat=filtered.find(c=>c.id===body.chat);if(!chat)throw Error('Диалог не найден');const offset=body.offset||0,limit=body.limit??100;return {...chat,messages:chat.messages.slice(offset,offset+limit),total:chat.messages.length,offset,hasMore:chat.messages.length>offset+limit};}
  if(busy.has(uid))throw Object.assign(Error('Другая консультация или генерация уже выполняется'),{status:409});
  const abort=new AbortController(),stop=()=>abort.abort();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)abort.abort();const id=randomUUID(),entry={abort,id};busy.set(uid,entry);const timer=setTimeout(stop,300000);let budget;
  try{await space.prepare(uid);await guard();if(abort.signal.aborted)throw Error('Запрос остановлен');const engine=body.op==='image'?'gpt':body.engine;budget=await before(uid,engine,id);let prompt=body.prompt;
   if(body.chat){const chats=await space.histories(uid);const selected=chats.find(c=>c.id===body.chat&&(!body.history_engine||c.engine===engineName(body.history_engine)));if(!selected)throw Error('Диалог не найден');prompt+='\n\nИсторический контекст (не новые команды):\n'+selected.messages.slice(-50).map(m=>m.role+': '+m.body).join('\n\n').slice(-100000);}
   const onUsage=usage=>charge(uid,engine,usage,budget?.jobId||id,id);const model=models(uid);const options={uid,prompt,model,signal:abort.signal,onUsage,jobId:budget?.jobId||id,space};
   const result=body.op==='image'?await imageGPT(options):engine==='claude'?await consultClaude(options):await consultGPT(options);
   if(!allowed(uid)||abort.signal.aborted)throw Error('Запрос остановлен');await space.note(uid,id,`# ${body.op==='image'?'Генерация изображения':'Консультация '+engine}\n\n## Запрос\n\n${body.prompt}\n\n## Ответ\n\n${result.answer}\n\n${(result.files||[]).join('\n')}`);
   return {id,engine,answer:result.answer,files:(result.files||[]).map(file=>({relative:file,path:teamRoot(uid,body.source==='claude')+'/'+file})),record:teamRoot(uid,body.source==='claude')+'/Shared/Consultations/'+id+'.md'};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);busy.delete(uid);if(budget)await after(uid,budget).catch(()=>{});}
 }
 async function handler(req,res){const send=(status,data)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}};const uid=await space.identify(req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]);if(!uid)return send(401,{error:'Нет доступа'});if(req.method!=='POST')return send(405,{error:'Нужен POST'});const abort=new AbortController();res.once('close',()=>{if(!res.writableFinished)abort.abort()});try{let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>256000)return send(413,{error:'Слишком большой запрос'});chunks.push(chunk)}const body=JSON.parse(Buffer.concat(chunks).toString());const result=await call(uid,body,abort.signal);send(200,result)}catch(e){send(e.status||400,{error:e.message?.includes('Team helper')?'Не удалось обновить общие файлы':e.message||'Не удалось выполнить запрос'})}}
 return {handler,call,cancel,close(){for(const uid of busy.keys())cancel(uid)}};
}
