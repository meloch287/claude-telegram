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
