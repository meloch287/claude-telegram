import {fetch,ProxyAgent} from "undici";
import {credentialFor,listRateLimits,recordRateLimit,getModeData,claimUsageFetch,delayUsageFetch} from "./db.js";
import {activeProxyUrl} from "./proxy.js";
import {limitTitle,toMillis} from "./limits.js";
const refreshing=new Map<number,Promise<void>>(),checked=new Map<number,number>(),failures=new Map<number,string>();
/**
 * Лимиты подписки Claude. Отдельный эндпоинт /api/oauth/usage у Anthropic почти
 * всегда отвечает 429 (закрывается на час), зато каждый ответ /v1/messages несёт
 * заголовки anthropic-ratelimit-unified-*: процент и сброс пятичасового и недельного
 * окна. Поэтому спрашиваем крошечным запросом к Haiku (1 токен) — не чаще раза в
 * 5 минут на человека, общий интервал для бота и bb (usage_fetch_gate).
 */
const PROBE_MODEL="claude-haiku-4-5-20251001";
export function limitsFromHeaders(headers:{get(name:string):string|null}):{limitType:string;utilization:number;resetsAt?:number}[]{
  const out:{limitType:string;utilization:number;resetsAt?:number}[]=[];
  for(const [suffix,limitType] of [["5h","five_hour"],["7d","seven_day"],["7d_opus","seven_day_opus"],["7d_sonnet","seven_day_sonnet"]] as const){
    const raw=headers.get(`anthropic-ratelimit-unified-${suffix}-utilization`);
    if(raw===null||raw==="")continue;
    const value=Number(raw);if(!Number.isFinite(value))continue;
    const reset=Number(headers.get(`anthropic-ratelimit-unified-${suffix}-reset`));
    // В заголовках доля (0.7), в статистике проценты (70).
    out.push({limitType,utilization:Math.round(value*1000)/10,...(Number.isFinite(reset)&&reset>0?{resetsAt:reset*1000}:{})});
  }
  return out;
}
export async function refreshClaudeUsage(uid:number,options:{httpOnly?:boolean}={}):Promise<void>{
  if(Date.now()-(checked.get(uid)||0)<60000){const failure=failures.get(uid);if(failure)throw Error(failure);return;}
  if(refreshing.has(uid))return refreshing.get(uid);
  const job=(async()=>{
    const credential=credentialFor(uid),proxy=activeProxyUrl()||process.env.TELEGRAM_PROXY||"";
    if(!credential||!proxy)throw Error("Claude или обязательный прокси недоступен");
    if(credential.kind!=="subscription"){checked.set(uid,Date.now());failures.delete(uid);return;} // у API-ключа нет лимитов плана
    if(!claimUsageFetch(uid)){checked.set(uid,Date.now());failures.delete(uid);return;}
    const agent=new ProxyAgent(proxy);
    try{
      const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",dispatcher:agent,signal:AbortSignal.timeout(15000),
        headers:{"content-type":"application/json","anthropic-version":"2023-06-01","anthropic-beta":"oauth-2025-04-20",...(credential.kind==="subscription"?{Authorization:`Bearer ${credential.secret}`}:{"x-api-key":credential.secret})},
        body:JSON.stringify({model:PROBE_MODEL,max_tokens:1,messages:[{role:"user",content:"."}]})});
      const limits=limitsFromHeaders(r.headers);
      await r.body?.cancel();
      if(r.status===429)delayUsageFetch(uid,Number(r.headers.get("retry-after"))||null);
      if(!limits.length)throw Error(r.status===429?"Лимит подписки исчерпан — показаны последние известные цифры":"Подписка не прислала лимиты");
      for(const limit of limits)recordRateLimit(uid,limit);
      checked.set(uid,Date.now());failures.delete(uid);
    }catch(error){checked.set(uid,Date.now());failures.set(uid,error instanceof Error?error.message:"Лимиты недоступны");throw error;}
    finally{await agent.close();}
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
    // Больше 100% Anthropic присылает, когда окно уже перебрано: шкала «из 100» с числом 116 только путает.
    const raw=resetsAt!==null&&resetsAt<Date.now()&&row?.utilization!=null?0:row?.utilization??null;
    const used=raw===null?null:Math.min(100,raw);
    return {type,title:limitTitle(type),used,resetsAt:resetsAt!==null&&resetsAt<Date.now()?null:resetsAt,seenAt:row?.seen_at??null};
  }),today:getModeData("claude").since(uid,Date.now()-Date.parse(new Date().toISOString().slice(0,10))),week:getModeData("claude").since(uid,7*86400000)};
}
export async function claudeUsageText(uid:number):Promise<string>{
  const data=await claudeUsage(uid);
  return ["Claude · Лимиты",...data.windows.map(w=>`${w.title}: ${w.used===null?"нет данных":w.used>=100?"исчерпано":Math.round(w.used)+"% использовано"}${w.resetsAt?" · сброс "+new Date(w.resetsAt).toLocaleString("ru-RU",{timeZone:"Europe/Moscow",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+" МСК":""}`),`Расход через бота за 7 дней: ${data.week.tokens.toLocaleString("ru-RU")} токенов`,...(data.stale?[data.notice+". Показаны последние полученные данные."]:[])].join("\n\n");
}
