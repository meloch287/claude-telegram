import { config } from "../config.js";
import { activeProxyUrl } from "../proxy.js";

/**
 * Расшифровка голосовых.
 *
 * Бэкенд задаётся адресом, а не зашит: свой WhisperX, локальный whisper.cpp или
 * любой сервис с совместимым интерфейсом OpenAI (`POST /v1/audio/transcriptions`,
 * поле `file`). Голос — чувствительные данные, и выбор, куда он уходит, должен
 * оставаться за владельцем установки.
 *
 * Если адрес не задан, бот говорит об этом прямо. Молчать в ответ на голосовое
 * хуже любой ошибки: выглядит как поломка.
 */

export class TranscriptionNotConfigured extends Error {
  constructor() {
    super("расшифровка голосовых не настроена");
  }
}

export function transcriptionConfigured(): boolean {
  return Boolean(config.whisperUrl || config.whisperFallbackUrl);
}

interface Backend {
  name: string;
  url: string;
  model: string;
  token: string;
  viaProxy: boolean;
}

function backends(): Backend[] {
  const list: Backend[] = [];
  if (config.whisperUrl) {
    list.push({
      name: "основной",
      url: config.whisperUrl,
      model: config.whisperModel,
      token: config.whisperToken,
      viaProxy: config.whisperViaProxy,
    });
  }
  if (config.whisperFallbackUrl) {
    list.push({
      name: "запасной",
      url: config.whisperFallbackUrl,
      model: config.whisperFallbackModel,
      token: config.whisperFallbackToken,
      // Запасной — локальный контейнер, прокси ему ни к чему.
      viaProxy: false,
    });
  }
  return list;
}

async function transcribeWith(
  backend: Backend,
  audio: Buffer,
  fileName: string,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), fileName);
  if (backend.model) form.append("model", backend.model);
  form.append("language", "ru");

  const headers: Record<string, string> = {};
  if (backend.token) headers.Authorization = `Bearer ${backend.token}`;

  const provider = new URL(backend.url).hostname;
  let body: RequestInit["body"] = form;
  if(provider==="api.polza.ai"||provider==="polza.ai"){
    const suffix=fileName.split(".").pop()?.toLowerCase()||"ogg";
    const mime:Record<string,string>={ogg:"audio/ogg",oga:"audio/ogg",mp3:"audio/mpeg",wav:"audio/wav",webm:"audio/webm",m4a:"audio/mp4",mp4:"audio/mp4",flac:"audio/flac"};
    headers["content-type"]="application/json";
    body=JSON.stringify({file:`data:${mime[suffix]||"audio/ogg"};base64,${audio.toString("base64")}`,model:backend.model.includes("/")?backend.model:`openai/${backend.model||"whisper-1"}`,language:"ru"});
  }
  const init: RequestInit = { method: "POST", body, headers };
  const local = ["localhost","127.0.0.1","[::1]"].includes(new URL(backend.url).hostname);
  let agent: import("undici").ProxyAgent | undefined;
  if(!local){
    const proxy=activeProxyUrl()||(process.env.TELEGRAM_PROXY??"").trim();
    if(!proxy)throw Error("Обязательный прокси недоступен");
    const {ProxyAgent}=await import("undici");
    agent=new ProxyAgent(proxy);
    (init as {dispatcher?:unknown}).dispatcher=agent;
  }

  // Локальный whisper на CPU может думать десятки секунд — даём запас, но не
  // вечность: зависший запрос хуже честного отказа.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  init.signal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  try {
    const response = agent
      ? await (await import("undici")).fetch(backend.url,init as never)
      : await fetch(backend.url, init);
    if (!response.ok) throw new Error(`сервис расшифровки ответил ${response.status}`);
    const payload = (await response.json()) as { text?: string; transcription?: string };
    const text = (payload.text ?? payload.transcription ?? "").trim();
    if (!text) throw new Error("сервис вернул пустую расшифровку");
    return text;
  } finally {
    clearTimeout(timer);
    await agent?.close();
  }
}

/**
 * Пробует бэкенды по очереди: основной, затем запасной. Любая ошибка
 * основного (402 «нет денег», 401, 5xx, сеть, таймаут) — повод перейти к
 * запасному, а не отказывать человеку. В ошибке итог по каждому.
 */
export async function transcribe(
  audio: Buffer,
  fileName: string,
  signal?: AbortSignal,
): Promise<string> {
  const chain = backends();
  if (chain.length === 0) throw new TranscriptionNotConfigured();

  const failures: string[] = [];
  for (const backend of chain) {
    try {
      return await transcribeWith(backend, audio, fileName, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${backend.name}: ${reason}`);
      console.warn(`[voice] ${backend.name} (${backend.url}) не справился: ${reason}`);
    }
  }
  throw new Error(failures.join("; "));
}
