import {fetch,ProxyAgent} from 'undici';
import {config} from '../config.js';
import {activeProxyUrl} from '../proxy.js';
type Avatar={bytes:Buffer;type:string;until:number};
export function avatarImageType(bytes:Buffer):string|null{
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return null;
}
const cache=new Map<number,Avatar|null>();
const pending=new Map<number,Promise<Avatar|null>>();
export async function telegramAvatar(uid:number):Promise<Avatar|null>{
 const cached=cache.get(uid);if(cached&&cached.until>Date.now())return cached;
 const existing=pending.get(uid);if(existing)return existing;
 const job=(async()=>{
  const proxy=activeProxyUrl() || process.env.TELEGRAM_PROXY || "";if(!proxy)return null;
  const agent=new ProxyAgent(proxy);
  try{
   async function api(method:string,body:unknown){
    const r=await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),dispatcher:agent,signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error('Фото временно недоступно');
    const data=await r.json() as {ok:boolean;result:any};if(!data.ok)throw Error('Фото временно недоступно');return data.result;
   }
   const photos=await api('getUserProfilePhotos',{user_id:uid,limit:1});
   const photo=photos.photos?.[0];if(!photo?.length)return null;
   const selected=photo[Math.min(1,photo.length-1)];
   const file=await api('getFile',{file_id:selected.file_id});
   if(typeof file.file_path!=='string'||!/^[A-Za-z0-9_./-]+$/.test(file.file_path)||file.file_path.includes('..'))return null;
   const r=await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,{dispatcher:agent,signal:AbortSignal.timeout(12000)});
   if(!r.ok||Number(r.headers.get('content-length')||0)>2*1024*1024)return null;
   const parts:Uint8Array[]=[];let size=0;
   if(!r.body)return null;
   for await(const chunk of r.body){size+=chunk.length;if(size>2*1024*1024)return null;parts.push(chunk)}
   const bytes=Buffer.concat(parts),type=avatarImageType(bytes);if(!type)return null;
   const value={bytes,type,until:Date.now()+900000};
   if(cache.size>100)cache.delete(cache.keys().next().value!);cache.set(uid,value);return value;
  }catch{return null}finally{await agent.close()}
 })().finally(()=>pending.delete(uid));
 pending.set(uid,job);return job;
}
