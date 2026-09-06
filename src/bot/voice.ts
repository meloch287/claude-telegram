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

async function transcribeWith(backend: Backend, audio: Buffer, fileName: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), fileName);
  if (backend.model) form.append("model", backend.model);
  form.append("language", "ru");

  const headers: Record<string, string> = {};
  if (backend.token) headers.Authorization = `Bearer ${backend.token}`;

  // По умолчанию идём напрямую, а не через канал до Anthropic.
  //
  // Прокси нужен только самому Anthropic: с российского сервера он отдаёт 403.
  // Сервис расшифровки выбирает владелец установки, и он обычно доступен без
  // обхода — проверено на api.polza.ai: HTTP 200 напрямую. Гнать голос через
  // Германию было бы лишним крюком, а для российского сервиса ещё и риском.
  // Если сервис всё же закрыт, включается WHISPER_VIA_PROXY=1.
  const init: RequestInit = { method: "POST", body: form, headers };
  const proxy = activeProxyUrl();
  if (backend.viaProxy && proxy) {
    const { ProxyAgent } = await import("undici");
    (init as { dispatcher?: unknown }).dispatcher = new ProxyAgent(proxy);
  }

  // Локальный whisper на CPU может думать десятки секунд — даём запас, но не
  // вечность: зависший запрос хуже честного отказа.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  init.signal = controller.signal;
  let response: Response;
  try {
    response = await fetch(backend.url, init);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`сервис расшифровки ответил ${response.status}`);
  }

  const payload = (await response.json()) as { text?: string; transcription?: string };
  const text = (payload.text ?? payload.transcription ?? "").trim();
  if (!text) throw new Error("сервис вернул пустую расшифровку");
  return text;
}

/**
 * Пробует бэкенды по очереди: основной, затем запасной. Любая ошибка
 * основного (402 «нет денег», 401, 5xx, сеть, таймаут) — повод перейти к
 * запасному, а не отказывать человеку. В ошибке итог по каждому.
 */
export async function transcribe(audio: Buffer, fileName: string): Promise<string> {
  const chain = backends();
  if (chain.length === 0) throw new TranscriptionNotConfigured();

  const failures: string[] = [];
  for (const backend of chain) {
    try {
      return await transcribeWith(backend, audio, fileName);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${backend.name}: ${reason}`);
      console.warn(`[voice] ${backend.name} (${backend.url}) не справился: ${reason}`);
    }
  }
  throw new Error(failures.join("; "));
}
