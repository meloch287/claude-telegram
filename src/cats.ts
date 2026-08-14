/**
 * Мини-игра: чем больше токенов потратил — тем солиднее твой Claude-кот.
 * Данные общие для бота и Mini App: бот шлёт текстом, мини-апп рисует SVG.
 */

export interface CatLevel {
  level: number;
  id: string;
  name: string;
  /** С какого количества суммарно потраченных токенов открывается. */
  threshold: number;
  title: string;
  /** Палитра: [шкура, тёмный оттенок для усов, слейт]. */
  palette: [string, string, string];
  accessory: string;
  quote: string;
}

export const CAT_LEVELS: CatLevel[] = [
  {
    level: 1,
    id: "intern",
    name: "Котёнок-стажёр",
    threshold: 0,
    title: "Только что открыл первый файл",
    palette: ["#D97757", "#A84F32", "#141413"],
    accessory: "клубок",
    quote: "Мяу. А где тут README?",
  },
  {
    level: 2,
    id: "reader",
    name: "Кот-читатель",
    threshold: 25_000,
    title: "Читает быстрее, чем ты скроллишь",
    palette: ["#8A8781", "#5E5B56", "#141413"],
    accessory: "очки",
    quote: "Я прочитал всё. Даже комментарии.",
  },
  {
    level: 3,
    id: "greper",
    name: "Кот-грепер",
    threshold: 100_000,
    title: "Находит нужную строку с первого раза",
    palette: ["#55534E", "#332F2B", "#141413"],
    accessory: "лупа",
    quote: "Оно в utils. Всегда в utils.",
  },
  {
    level: 4,
    id: "refactor",
    name: "Кот-рефакторщик",
    threshold: 300_000,
    title: "Удалил больше строк, чем написал",
    palette: ["#D6B489", "#A07F53", "#141413"],
    accessory: "ножницы",
    quote: "Этой абстракции здесь быть не должно.",
  },
  {
    level: 5,
    id: "debugger",
    name: "Кот-дебагер",
    threshold: 750_000,
    title: "Видит баг сквозь стек-трейс",
    palette: ["#C4633E", "#8E4227", "#141413"],
    accessory: "фонарик",
    quote: "Воспроизводится. Дальше дело техники.",
  },
  {
    level: 6,
    id: "architect",
    name: "Кот-архитектор",
    threshold: 1_500_000,
    title: "Рисует схемы, которые потом сбываются",
    palette: ["#6A9BCC", "#3F6A96", "#141413"],
    accessory: "чертёж",
    quote: "Разложим на модули — и станет скучно. В хорошем смысле.",
  },
  {
    level: 7,
    id: "reviewer",
    name: "Кот-ревьюер",
    threshold: 3_000_000,
    title: "Оставляет комментарии, с которыми не поспоришь",
    palette: ["#7E9166", "#556042", "#141413"],
    accessory: "красная ручка",
    quote: "Здесь гонка. Вот сценарий.",
  },
  {
    level: 8,
    id: "orchestrator",
    name: "Кот-оркестратор",
    threshold: 6_000_000,
    title: "Запускает субагентов и не путается",
    palette: ["#6B4E9B", "#46316B", "#141413"],
    accessory: "дирижёрская палочка",
    quote: "Ты, ты и ты — по файлу каждому.",
  },
  {
    level: 9,
    id: "opus",
    name: "Кот-опус",
    threshold: 12_000_000,
    title: "Работает всю ночь, к утру всё зелёное",
    palette: ["#A85236", "#743520", "#141413"],
    accessory: "кружка",
    quote: "Тесты прошли. Все. Проверил дважды.",
  },
  {
    level: 10,
    id: "quantum",
    name: "Квантовый кот",
    threshold: 25_000_000,
    title: "Одновременно исправил и не трогал",
    palette: ["#E0A93B", "#A2731F", "#141413"],
    accessory: "коробка",
    quote: "Пока ты не открыл PR, баг и есть, и нет.",
  },
];

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_blood", name: "Первое слово", description: "Отправить боту первое сообщение", icon: "👋" },
  { id: "first_tool", name: "Первый инструмент", description: "Разрешить агенту первый вызов инструмента", icon: "🔧" },
  { id: "first_edit", name: "Правка пошла", description: "Одобрить первое изменение файла", icon: "✏️" },
  { id: "first_bash", name: "Терминал открыт", description: "Разрешить первую команду в Bash", icon: "🖥️" },
  { id: "first_deny", name: "Нет — тоже ответ", description: "Отклонить вызов инструмента", icon: "🛑" },
  { id: "night_owl", name: "Ночная смена", description: "Написать боту между 02:00 и 05:00", icon: "🌙" },
  { id: "streak_7", name: "Неделя подряд", description: "Пользоваться ботом 7 дней подряд", icon: "🔥" },
  { id: "hundred_msgs", name: "Сотня", description: "Отправить 100 сообщений", icon: "💬" },
  { id: "million", name: "Миллион", description: "Потратить 1 000 000 токенов", icon: "🎯" },
  { id: "interrupter", name: "Стоп-кран", description: "Прервать агента на полпути", icon: "⏹️" },
  { id: "polyglot", name: "Многостаночник", description: "Поработать в трёх разных проектах", icon: "🗂️" },
  { id: "max_cat", name: "Предел", description: "Дорасти до Квантового кота", icon: "🐈‍⬛" },
];

export function catForTokens(totalTokens: number): CatLevel {
  let current = CAT_LEVELS[0]!;
  for (const cat of CAT_LEVELS) {
    if (totalTokens >= cat.threshold) current = cat;
  }
  return current;
}

export function nextCat(totalTokens: number): CatLevel | null {
  return CAT_LEVELS.find((c) => c.threshold > totalTokens) ?? null;
}

/** Прогресс к следующему уровню, 0..1. На максимальном уровне — 1. */
export function catProgress(totalTokens: number): number {
  const current = catForTokens(totalTokens);
  const next = nextCat(totalTokens);
  if (!next) return 1;
  const span = next.threshold - current.threshold;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (totalTokens - current.threshold) / span));
}

export function formatTokens(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}
