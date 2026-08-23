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
export async function fetchTelegramFile(url: string): Promise<Response> {
  const forced = (process.env.TELEGRAM_PROXY ?? "").trim();
  if (!forced) {
    try {
      return await fetch(url);
    } catch (error) {
      const proxy = activeProxyUrl();
      if (!proxy) throw error;
      return viaProxy(url, proxy);
    }
  }
  return viaProxy(url, forced);
}

async function viaProxy(url: string, proxy: string): Promise<Response> {
  const { fetch: undiciFetch, ProxyAgent } = await import("undici");
  const response = await undiciFetch(url, { dispatcher: new ProxyAgent(proxy) });
  return response as unknown as Response;
}
