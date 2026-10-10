import {fetch,ProxyAgent} from "undici";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {credentialFor,listRateLimits,recordRateLimit,getModeData,claimUsageFetch,delayUsageFetch} from "./db.js";
import {credentialEnv} from "./auth.js";
import {activeProxyUrl} from "./proxy.js";
import {spawnWorker,workerFor} from "./agent/isolation.js";
import {limitTitle,toMillis} from "./limits.js";
const refreshing=new Map<number,Promise<void>>(),checked=new Map<number,number>(),failures=new Map<number,string>();
export async function refreshClaudeUsage(uid:number,options:{httpOnly?:boolean}={}):Promise<void>{
  if(Date.now()-(checked.get(uid)||0)<60000){const failure=failures.get(uid);if(failure)throw Error(failure);return;}
  if(refreshing.has(uid))return refreshing.get(uid);
  const job=(async()=>{
    const credential=credentialFor(uid),proxy=activeProxyUrl()||(options.httpOnly?process.env.TELEGRAM_PROXY||"":"");
    if(!credential||!proxy)throw Error("Claude или обязательный прокси недоступен");
    // Общий для бота и bb интервал: чаще Anthropic отвечает 429 и надолго закрывает лимиты.
    if(!claimUsageFetch(uid)){checked.set(uid,Date.now());failures.delete(uid);return;}
    const tooOften=(r:{status:number;headers:{get(name:string):string|null}})=>{if(r.status===429)delayUsageFetch(uid,Number(r.headers.get("retry-after"))||null);};
    if(options.httpOnly){
      const agent=new ProxyAgent(proxy);
      try{
        const r=await fetch("https://api.anthropic.com/api/oauth/usage",{headers:{Authorization:`Bearer ${credential.secret}`,"anthropic-beta":"oauth-2025-04-20"},dispatcher:agent,signal:AbortSignal.timeout(8000)});
        if(!r.ok){tooOften(r);await r.body?.cancel();throw Error(r.status===429?"Anthropic попросил реже спрашивать лимиты — показаны последние известные":"Подписка пока не предоставила свежие лимиты");}
        const limits=await r.json() as Record<string,{utilization?:number|null;resets_at?:string|null}|null>;
        for(const [type,row] of Object.entries(limits)){
          if(!row||typeof row.utilization!=="number")continue;
          const reset=row.resets_at?Date.parse(row.resets_at):NaN;
          recordRateLimit(uid,{limitType:type,utilization:row.utilization,...(Number.isFinite(reset)?{resetsAt:reset}:{})});
        }
        checked.set(uid,Date.now());failures.delete(uid);
      }catch(error){checked.set(uid,Date.now());failures.set(uid,"Свежие лимиты Claude временно недоступны");throw error;}finally{await agent.close();}
      return;
    }
    const worker=workerFor(uid),abort=new AbortController();
    let finish:(()=>void)|undefined;
    const prompt={async *[Symbol.asyncIterator](){await new Promise<void>(r=>{finish=r;});}};
    const q=query({prompt,options:{cwd:worker.home,persistSession:false,settingSources:["user"],abortController:abort,
      env:{PATH:"/usr/local/bin:/usr/bin:/bin",HOME:worker.home,USER:worker.name,LANG:"C.UTF-8",HTTP_PROXY:proxy,HTTPS_PROXY:proxy,NO_PROXY:"localhost,127.0.0.1",...credentialEnv(credential)},
      spawnClaudeCodeProcess:options=>spawnWorker(uid,options)}});
    const timer=setTimeout(()=>abort.abort(),15000);
    try{
      const data=await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({skipBehaviors:true});
      let limits:Record<string,unknown>|null=data.rate_limits;
      if(!data.rate_limits_available||!limits){
        const agent=new ProxyAgent(proxy);
        try{
          const r=await fetch("https://api.anthropic.com/api/oauth/usage",{headers:{Authorization:`Bearer ${credential.secret}`,"anthropic-beta":"oauth-2025-04-20"},dispatcher:agent,signal:AbortSignal.timeout(8000)});
          if(!r.ok){tooOften(r);await r.body?.cancel();throw Error(r.status===429?"Anthropic попросил реже спрашивать лимиты — показаны последние известные":"Подписка не предоставила лимиты");}
          limits=await r.json() as Record<string,unknown>;
        }finally{await agent.close();}
      }
      for(const [type,value] of Object.entries(limits)){
        if(!value||typeof value!=="object"||!("utilization" in value))continue;
        const row=value as {utilization?:number|null;resets_at?:string|null};
        if(typeof row.utilization!=="number")continue;
        const reset=row.resets_at?Date.parse(row.resets_at):NaN;
        recordRateLimit(uid,{limitType:type,utilization:row.utilization,...(Number.isFinite(reset)?{resetsAt:reset}:{})});
      }
      checked.set(uid,Date.now());failures.delete(uid);
    }catch(error){checked.set(uid,Date.now());failures.set(uid,error instanceof Error?error.message:"Лимиты недоступны");throw error;}finally{clearTimeout(timer);finish?.();q.close();}
  })().finally(()=>refreshing.delete(uid));
  refreshing.set(uid,job);return job;
}
export async function claudeUsage(uid:number,options:{httpOnly?:boolean}={}){
  let stale=false,notice="";
  try{await refreshClaudeUsage(uid,options);}catch(error){stale=true;notice=error instanceof Error?error.message:"Лимиты недоступны";}
  const known=new Map(listRateLimits(uid).map(r=>[r.limit_type,r]));
  const types=[...new Set(["five_hour","seven_day",...known.keys()])];
  return {engine:"claude",stale,notice,windows:types.map(type=>{
    const row=known.get(type);
    const resetsAt=row?.resets_at?toMillis(row.resets_at):null;
    // Окно уже сбросилось после последнего замера — значит, израсходовано 0%.
    const used=resetsAt!==null&&resetsAt<Date.now()&&row?.utilization!=null?0:row?.utilization??null;
    return {type,title:limitTitle(type),used,resetsAt:resetsAt!==null&&resetsAt<Date.now()?null:resetsAt,seenAt:row?.seen_at??null};
  }),today:getModeData("claude").since(uid,Date.now()-Date.parse(new Date().toISOString().slice(0,10))),week:getModeData("claude").since(uid,7*86400000)};
}
export async function claudeUsageText(uid:number):Promise<string>{
  const data=await claudeUsage(uid);
  return ["Claude · Лимиты",...data.windows.map(w=>`${w.title}: ${w.used===null?"нет данных":Math.round(w.used)+"% использовано"}${w.resetsAt?" · сброс "+new Date(w.resetsAt).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):""}`),`Расход через бота за 7 дней: ${data.week.tokens.toLocaleString("ru-RU")} токенов`,...(data.stale?[data.notice+". Показаны последние полученные данные."]:[])].join("\n\n");
}
