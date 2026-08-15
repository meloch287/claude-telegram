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

  // Сервис может стоять снаружи и быть недоступен напрямую — тогда через тот же
  // канал, что и остальное.
  const proxy = activeProxyUrl();
  const init: RequestInit = { method: "POST", body: form, headers };
  if (proxy && !/^https?:\/\/(localhost|127\.|\[?::1)/.test(config.whisperUrl)) {
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
