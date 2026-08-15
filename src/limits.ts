/**
 * Окна лимитов подписки: как они называются по-человечески и в чём измеряется
 * время сброса. Общее для бота и мини-аппа, чтобы названия не разошлись.
 */

export const LIMIT_TITLES: Record<string, string> = {
  five_hour: "Пятичасовое окно",
  seven_day: "Недельный лимит",
  seven_day_oauth_apps: "Недельный лимит приложений",
  seven_day_opus: "Недельный лимит Opus",
  seven_day_sonnet: "Недельный лимит Sonnet",
  seven_day_overage_included: "Недельный лимит с перерасходом",
  overage: "Перерасход",
};

/** Окна подписки: длительность и то, откуда брать потолок для процента. */
export const WINDOWS: { type: string; ms: number }[] = [
  { type: "five_hour", ms: 5 * 60 * 60 * 1000 },
  { type: "seven_day", ms: 7 * 24 * 60 * 60 * 1000 },
];

/** Доля от потолка в процентах. null — потолок не задан, считать не от чего. */
export function percentOf(tokens: number, ceiling: number): number | null {
  if (!ceiling || ceiling <= 0) return null;
  // Больше ста не показываем: шкала «из 100%» с числом 137 сбивает с толку,
  // а сам факт перебора виден по абсолютному числу рядом.
  return Math.min(100, Math.round((tokens / ceiling) * 100));
}

export function limitTitle(type: string): string {
  return LIMIT_TITLES[type] ?? type;
}

/**
 * resetsAt приходит от SDK без указания единиц. Значения до 1e12 — это секунды
 * (2001 год в миллисекундах), выше — уже миллисекунды. Ошибка в тысячу раз
 * превратила бы «через два часа» в «через сто лет», поэтому определяем явно.
 */
export function toMillis(value: number): number {
  return value < 1e12 ? value * 1000 : value;
}
