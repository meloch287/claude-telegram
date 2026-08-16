import { config } from "../config.js";
import { activeProxyUrl } from "../proxy.js";

/**
 * Озвучка ответов.
 *
 * Бэкенд задаётся адресом, как и расшифровка: любой сервис с интерфейсом
 * OpenAI (`POST /v1/audio/speech`). Ответ бывает двух видов — сырые байты звука
 * или JSON с полем `audio` в base64; разбираем оба, потому что совместимость
 * тут заканчивается на адресе.
 *
 * Не настроено — молчим и отвечаем текстом. Озвучка это удобство, и ошибка в
 * ней не должна съедать сам ответ.
 */

/** Дальше слушать всё равно не станут, а синтез стоит денег и времени. */
const MAX_CHARS = 900;

export function speechConfigured(): boolean {
  return Boolean(config.ttsUrl);
}

/**
 * Готовит текст к чтению вслух: разметка, ссылки и куски кода на слух
 * превращаются в кашу, а читаются долго.
 */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " фрагмент кода. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/https?:\/\/\S+/g, " ссылка ")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function synthesize(text: string): Promise<Buffer | null> {
  if (!config.ttsUrl) return null;
  const clean = forSpeech(text);
  if (!clean) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (config.ttsToken) headers.authorization = `Bearer ${config.ttsToken}`;

    const body = JSON.stringify({
      model: config.ttsModel || undefined,
      voice: config.ttsVoice || undefined,
      input: clean.slice(0, MAX_CHARS),
    });

    // Прокси по умолчанию не нужен: сервис озвучки обычно ближе, чем Anthropic.
    const proxy = config.ttsViaProxy ? activeProxyUrl() : "";
    const response = proxy
      ? await (async () => {
          const { fetch: viaProxy, ProxyAgent } = await import("undici");
          return viaProxy(config.ttsUrl, {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
            dispatcher: new ProxyAgent(proxy),
          }) as unknown as Response;
        })()
      : await fetch(config.ttsUrl, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });

    if (!response.ok) {
      console.error(`озвучка: HTTP ${response.status}`);
      return null;
    }

    const type = response.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const json = (await response.json()) as { audio?: string };
      if (!json.audio) return null;
      return Buffer.from(json.audio, "base64");
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    // Озвучка — удобство. Не вышло — ответ уже ушёл текстом, и это главное.
    console.error("озвучка не удалась:", (error as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
