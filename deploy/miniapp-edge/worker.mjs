// Public transport only. Telegram authentication and user isolation stay at the origin.
const ORIGIN = 'https://aiapp.200-165-236-8.sslip.io';

export async function relay(request, originFetch = fetch) {
  const incoming = new URL(request.url);
  if (incoming.protocol !== 'https:') {
    incoming.protocol = 'https:';
    return Response.redirect(incoming.href, 308);
  }
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS' } });
  }
  const upstream = new URL(ORIGIN);
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  const headers = new Headers();
  for (const key of ['content-type', 'accept', 'accept-language', 'x-telegram-init-data', 'x-bot-engine', 'range', 'if-range']) {
    if (request.headers.has(key)) headers.set(key, request.headers.get(key));
  }
  let response;
  try {
    response = await originFetch(upstream.href, {
      method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual', signal: request.signal,
    });
  } catch {
    return new Response('Сервис временно недоступен. Закрой мини-приложение и открой его ещё раз.', {
      status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  const outgoing = new Headers(response.headers);
  outgoing.set('cache-control', 'no-store');
  outgoing.set('x-content-type-options', 'nosniff');
  outgoing.set('referrer-policy', 'no-referrer');
  outgoing.delete('alt-svc');
  const location = outgoing.get('location');
  if (location) {
    const next = new URL(location, upstream);
    if (next.origin === ORIGIN) {
      next.protocol = incoming.protocol;
      next.host = incoming.host;
      outgoing.set('location', next.href);
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outgoing });
}

export default { fetch(request) { return relay(request); } };
