const tg=globalThis.window?.Telegram?.WebApp;
let uid=tg?.initDataUnsafe?.user?.id;
try{uid??=JSON.parse(new URLSearchParams(tg?.initData||'').get('user')||'{}').id}catch{}
export const userKey=Number.isSafeInteger(Number(uid))?String(uid):'guest';
const selected=new URLSearchParams(globalThis.location?.search||'').get('engine');
let remembered;try{remembered=globalThis.localStorage?.getItem('bot:engine:'+userKey)}catch{}
export const engine=selected==='claude'||selected==='gpt'?selected:remembered==='claude'?'claude':'gpt';
export const modeHeaders=initData=>({'X-Telegram-Init-Data':initData,'X-Bot-Engine':engine});
export function scopedStorage(storage,uid,mode){
 const prefix=`bot-world:v2:${uid}:${mode}:`;
 const keys=()=>Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k?.startsWith(prefix));
 return {get length(){return keys().length},key:i=>keys()[i]?.slice(prefix.length)??null,getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,value),removeItem:key=>storage.removeItem(prefix+key),clear(){for(const key of keys())storage.removeItem(key)}};
}
const memory=new Map();
const fallback={get length(){return memory.size},key:i=>[...memory.keys()][i]??null,getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
let raw;try{raw=globalThis.localStorage;raw.getItem('bot:storage-check')}catch{raw=fallback}
export const modeStorage=scopedStorage(raw||fallback,userKey,engine);
export function migrateOwnWorld(seed){
 if(engine!=='gpt'||userKey==='guest'||modeStorage.getItem('migration:legacy'))return;
 const patterns=[new RegExp(`^world:(?:map|discovered):${seed}$`),new RegExp(`^world:(?:v\\d+|quests):${seed}:[A-Za-z0-9_-]+$`)];
 for(let i=0;i<raw.length;i++){const key=raw.key(i);if(patterns.some(p=>p.test(key))&&modeStorage.getItem(key)===null)modeStorage.setItem(key,raw.getItem(key))}
 modeStorage.setItem('migration:legacy','1');
}
