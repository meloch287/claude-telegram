/**
 * Выбор канала выхода в интернет для агента.
 *
 * Нужен ли прокси — определяется не страной сервера и не флагом в конфиге, а
 * пробой: запрос без авторизации к api.anthropic.com. Сервер может стоять в
 * России с рабочим выходом или в Европе за фильтром, поэтому факт надёжнее
 * настройки.
 *
 *   401 — запрос дошёл, отбит за отсутствие ключа. Канал рабочий.
 *   403 — заблокировано по географии. Нужен другой канал.
 *   иное / таймаут — сети нет; прокси такое не лечит.
 */

const PROBE_URL = "https://api.anthropic.com/v1/models";
const PROBE_TIMEOUT_MS = 15_000;

export interface ProxyCandidate {
  /** Пустая строка — прямой выход без прокси. */
  url: string;
  label: string;
}

export interface ChannelStatus {
  candidate: ProxyCandidate;
  reachable: boolean;
  httpStatus: number | null;
  /** Код страны выходного адреса, если удалось определить. */
  country: string | null;
  exitIp: string | null;
  error?: string;
}

/**
 * Разбирает PROXY_POOL: адреса через запятую, порядок задаёт приоритет.
 *
 * Если прокси уже задан окружением (например, через compose на сервере), он
 * добавляется в конец пула. Иначе сервис, не найдя своего пула, стёр бы
 * унаследованный HTTPS_PROXY и сломал бы рабочую установку.
 */
export function parsePool(raw: string, env: NodeJS.ProcessEnv = process.env): ProxyCandidate[] {
  const pool = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url, index) => ({ url, label: `прокси ${index + 1} (${hideCredentials(url)})` }));

  const inherited = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (inherited && !pool.some((c) => c.url === inherited)) {
    pool.push({ url: inherited, label: `прокси из окружения (${hideCredentials(inherited)})` });
  }
  return pool;
}

/** Логин и пароль в адресе прокси не должны попадать в логи. */
export function hideCredentials(url: string): string {
  return url.replace(/\/\/[^@/]+@/, "//***@");
}

interface ProbeResponse {
  status: number;
  text(): Promise<string>;
}

/**
 * Запрос через указанный прокси. Возвращает не Response, а минимум, который
 * нужен пробе: типы глобального fetch и пакета undici не сходятся, а смешивать
 * их ради одного поля незачем.
 *
 * Прокси задаётся явным диспетчером: глобальный fetch переменные окружения с
 * прокси не читает вовсе.
 */
async function fetchThrough(
  url: string,
  proxy: string,
  signal: AbortSignal,
): Promise<ProbeResponse> {
  if (!proxy) return fetch(url, { signal });
  const { fetch: viaProxy, ProxyAgent } = await import("undici");
  return viaProxy(url, { signal, dispatcher: new ProxyAgent(proxy) });
}

/** Куда смотрит канал наружу. Ошибка определения не делает канал негодным. */
async function detectExit(
  proxy: string,
  signal: AbortSignal,
): Promise<{ ip: string | null; country: string | null }> {
  try {
    const response = await fetchThrough("https://www.cloudflare.com/cdn-cgi/trace", proxy, signal);
    const text = await response.text();
    const ip = /^ip=(.+)$/m.exec(text)?.[1] ?? null;
    const loc = /^loc=(.+)$/m.exec(text)?.[1] ?? null;
    return { ip, country: loc };
  } catch {
    return { ip: null, country: null };
  }
}

export async function probe(candidate: ProxyCandidate): Promise<ChannelStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchThrough(PROBE_URL, candidate.url, controller.signal);
    const exit = await detectExit(candidate.url, controller.signal);
    return {
      candidate,
      // 401 значит «дошли до Anthropic». 403 — заблокировано по географии.
      reachable: response.status === 401,
      httpStatus: response.status,
      country: exit.country,
      exitIp: exit.ip,
    };
  } catch (error) {
    return {
      candidate,
      reachable: false,
      httpStatus: null,
      country: null,
      exitIp: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface ChannelChoice {
  active: ChannelStatus | null;
  checked: ChannelStatus[];
}

/**
 * Выбирает канал: сперва прямой выход, затем пул по порядку. Возвращает и
 * выбранный канал, и результаты всех проб — по ним видно, почему выбран
 * именно этот.
 */
export async function chooseChannel(
  pool: ProxyCandidate[],
  options: { requireCountry?: string } = {},
): Promise<ChannelChoice> {
  const checked: ChannelStatus[] = [];

  const direct = await probe({ url: "", label: "прямой выход" });
  checked.push(direct);
  if (direct.reachable) return { active: direct, checked };

  for (const candidate of pool) {
    const status = await probe(candidate);
    checked.push(status);
    if (!status.reachable) continue;
    // Требование к стране — предупреждение, а не отказ: рабочий канал не той
    // страны лучше, чем неработающий нужной. Но молчать об этом нельзя.
    if (options.requireCountry && status.country !== options.requireCountry) {
      console.warn(
        `⚠️  ${candidate.label}: выход через ${status.country ?? "неизвестно"}, ожидался ${options.requireCountry}`,
      );
    }
    return { active: status, checked };
  }

  return { active: null, checked };
}

export function describeChannel(status: ChannelStatus): string {
  const where = status.candidate.url ? hideCredentials(status.candidate.url) : "напрямую";
  const exit = status.exitIp ? ` · выход ${status.exitIp}` : "";
  const country = status.country ? ` · страна ${status.country}` : "";
  return `${where}${country}${exit}`;
}

/**
 * Текущий канал. Держится в модуле, потому что его читает каждый запуск
 * подпроцесса агента, а перевыбирается он редко и в одном месте.
 */
let active: ChannelStatus | null = null;

export function setActiveChannel(status: ChannelStatus | null): void {
  active = status;
}

export function activeChannel(): ChannelStatus | null {
  return active;
}

/** Адрес прокси для окружения подпроцесса. Пустая строка — идти напрямую. */
export function activeProxyUrl(): string {
  return active?.candidate.url ?? "";
}

/**
 * Периодическая перепроверка канала.
 *
 * Выбор на старте — снимок одного момента. Германский сервер может отвалиться
 * посреди дня, и тогда бот продолжал бы слать запросы в мёртвый адрес, пока
 * кто-нибудь не перезапустит контейнер. Проверка дешёвая: один запрос к
 * api.anthropic.com, ответ 401 без ключа.
 *
 * Сначала проверяется текущий канал: если он жив, остальные не трогаем — это
 * один запрос вместо полного перебора. Полный выбор запускается, только когда
 * текущий отвалился.
 */
export interface ChannelWatchOptions {
  requireCountry?: string;
  intervalMs?: number;
  /** Зовётся при смене канала и когда живого канала не осталось. */
  onChange?: (next: ChannelStatus | null, previous: ChannelStatus | null) => void;
}

const WATCH_INTERVAL_MS = 10 * 60_000;

export function startChannelWatch(
  pool: ProxyCandidate[],
  options: ChannelWatchOptions = {},
): () => void {
  const interval = options.intervalMs ?? WATCH_INTERVAL_MS;
  let checking = false;

  async function tick(): Promise<void> {
    // Проба идёт по сети и может растянуться; параллельные заходы не нужны.
    if (checking) return;
    checking = true;
    try {
      const previous = activeChannel();
      if (previous) {
        const again = await probe(previous.candidate);
        if (again.reachable) {
          // Канал жив: обновляем снимок, чтобы /status показывал свежие данные.
          setActiveChannel(again);
          return;
        }
        console.warn(
          `⚠️  Канал отвалился: ${previous.candidate.label} — ${again.httpStatus === null ? again.error ?? "нет ответа" : `HTTP ${again.httpStatus}`}`,
        );
      }

      const choice = await chooseChannel(pool, { requireCountry: options.requireCountry });
      setActiveChannel(choice.active);
      if (choice.active) {
        console.log(`🌍 Канал переключён: ${describeChannel(choice.active)}`);
      } else {
        console.warn("⚠️  Живого канала до Anthropic не осталось.");
      }
      // Молчим, если менять было нечего: сообщение о «переключении» на тот же
      // адрес только путало бы.
      const changed = choice.active?.candidate.url !== previous?.candidate.url;
      if (changed || (previous && !choice.active)) options.onChange?.(choice.active, previous);
    } catch (error) {
      console.error("⚠️  Перепроверка канала не удалась:", (error as Error).message);
    } finally {
      checking = false;
    }
  }

  const timer = setInterval(() => void tick(), interval);
  timer.unref();
  return () => clearInterval(timer);
}
