import { activeProxyUrl } from "../proxy.js";

/**
 * Скачивание файла из Telegram.
 *
 * Здесь дважды наступили на грабли. Сначала файлы качались голым fetch, и на
 * этом хосте запрос к api.telegram.org иногда не проходил — человек видел
 * «Не смог принять файл: fetch failed». Тогда всё завернули в прокси через
 * undici ProxyAgent — и сломали окончательно: у Node 24 свой встроенный undici,
 * и диспетчер из пакета в глобальный fetch не подходит, каждая попытка падала с
 * «invalid onRequestStart method». То есть починка выключила файлы и голосовые
 * целиком.
 *
 * Поэтому теперь так: сперва прямой запрос, он на этом хосте работает и стоит
 * дешевле; если не вышел — повтор через прокси, но fetch берём из того же
 * пакета undici, что и ProxyAgent, иначе версии диспетчера расходятся.
 * TELEGRAM_PROXY заставляет идти через прокси сразу.
 */
export async function fetchTelegramFile(url: string, signal?: AbortSignal): Promise<Response> {
  const forced = (process.env.TELEGRAM_PROXY ?? "").trim() || (process.env.REQUIRE_PROXY === "1" ? activeProxyUrl() : "");
  if (!forced && process.env.REQUIRE_PROXY === "1") throw Error("Обязательный прокси недоступен");
  const timeout = AbortSignal.timeout(60000);
  signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  if (!forced) {
    try {
      return await fetch(url, { signal });
    } catch (error) {
      const proxy = activeProxyUrl();
      if (!proxy) throw error;
      signal.throwIfAborted();
      return viaProxy(url, proxy, signal);
    }
  }
  return viaProxy(url, forced, signal);
}

async function viaProxy(url: string, proxy: string, signal?: AbortSignal): Promise<Response> {
  const { fetch: undiciFetch, ProxyAgent } = await import("undici");
  const dispatcher = new ProxyAgent(proxy);
  const response = await undiciFetch(url, { dispatcher, signal });
  // Closing drains the response before releasing pooled sockets.
  void dispatcher.close().catch(() => {});
  return response as unknown as Response;
}
