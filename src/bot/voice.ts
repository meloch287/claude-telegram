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
  return Boolean(config.whisperUrl);
}

export async function transcribe(audio: Buffer, fileName: string): Promise<string> {
  if (!config.whisperUrl) throw new TranscriptionNotConfigured();

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), fileName);
  if (config.whisperModel) form.append("model", config.whisperModel);
  form.append("language", "ru");

  const headers: Record<string, string> = {};
  if (config.whisperToken) headers.Authorization = `Bearer ${config.whisperToken}`;

  // По умолчанию идём напрямую, а не через канал до Anthropic.
  //
  // Прокси нужен только самому Anthropic: с российского сервера он отдаёт 403.
  // Сервис расшифровки выбирает владелец установки, и он обычно доступен без
  // обхода — проверено на api.polza.ai: HTTP 200 напрямую. Гнать голос через
  // Германию было бы лишним крюком, а для российского сервиса ещё и риском.
  // Если сервис всё же закрыт, включается WHISPER_VIA_PROXY=1.
  const init: RequestInit = { method: "POST", body: form, headers };
  const proxy = activeProxyUrl();
  if (config.whisperViaProxy && proxy) {
    const { ProxyAgent } = await import("undici");
    (init as { dispatcher?: unknown }).dispatcher = new ProxyAgent(proxy);
  }

  const response = await fetch(config.whisperUrl, init);
  if (!response.ok) {
    throw new Error(`сервис расшифровки ответил ${response.status}`);
  }

  const payload = (await response.json()) as { text?: string; transcription?: string };
  const text = (payload.text ?? payload.transcription ?? "").trim();
  if (!text) throw new Error("сервис вернул пустую расшифровку");
  return text;
}
