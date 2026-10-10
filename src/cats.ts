/**
 * Мини-игра: чем больше токенов потратил — тем солиднее твой GPT-кот.
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
    name: "GPT-котёнок",
    threshold: 0,
    title: "Только что открыл первый файл",
    palette: ["#6EE7C0", "#188A70", "#152923"],
    accessory: "клубок",
    quote: "Мяу. А где тут README?",
  },
  {
    level: 2,
    id: "reader",
    name: "Кот-исследователь",
    threshold: 500_000,
    title: "Читает быстрее, чем ты скроллишь",
    palette: ["#9ADDE8", "#397D8A", "#152923"],
    accessory: "очки",
    quote: "Я прочитал всё. Даже комментарии.",
  },
  {
    level: 3,
    id: "greper",
    name: "Кот Codex",
    threshold: 2_000_000,
    title: "Находит нужную строку с первого раза",
    palette: ["#91A6B8", "#445A6F", "#152923"],
    accessory: "лупа",
    quote: "Оно в utils. Всегда в utils.",
  },
  {
    level: 4,
    id: "refactor",
    name: "Кот Luna",
    threshold: 6_000_000,
    title: "Удалил больше строк, чем написал",
    palette: ["#C4B5FD", "#7960BF", "#152923"],
    accessory: "ножницы",
    quote: "Этой абстракции здесь быть не должно.",
  },
  {
    level: 5,
    id: "debugger",
    name: "Кот-навигатор",
    threshold: 15_000_000,
    title: "Видит баг сквозь стек-трейс",
    palette: ["#A9E67F", "#527F35", "#152923"],
    accessory: "фонарик",
    quote: "Воспроизводится. Дальше дело техники.",
  },
  {
    level: 6,
    id: "architect",
    name: "Кот Sol",
    threshold: 30_000_000,
    title: "Рисует схемы, которые потом сбываются",
    palette: ["#F1D67A", "#AA832C", "#152923"],
    accessory: "чертёж",
    quote: "Разложим на модули — и станет скучно. В хорошем смысле.",
  },
  {
    level: 7,
    id: "reviewer",
    name: "Кот-инженер",
    threshold: 60_000_000,
    title: "Оставляет комментарии, с которыми не поспоришь",
    palette: ["#80D5CA", "#2A807A", "#152923"],
    accessory: "красная ручка",
    quote: "Здесь гонка. Вот сценарий.",
  },
  {
    level: 8,
    id: "orchestrator",
    name: "Кот Astra",
    threshold: 120_000_000,
    title: "Запускает субагентов и не путается",
    palette: ["#AEA1F3", "#6757AC", "#152923"],
    accessory: "дирижёрская палочка",
    quote: "Ты, ты и ты — по файлу каждому.",
  },
  {
    level: 9,
    id: "creator",
    name: "Кот-создатель",
    threshold: 250_000_000,
    title: "Работает всю ночь, к утру всё зелёное",
    palette: ["#79DBC0", "#2E8D76", "#152923"],
    accessory: "кружка",
    quote: "Тесты прошли. Все. Проверил дважды.",
  },
  {
    level: 10,
    id: "quantum",
    name: "Квантовый GPT-кот",
    threshold: 500_000_000,
    title: "Одновременно исправил и не трогал",
    palette: ["#CEEFA2", "#759C48", "#152923"],
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
  {
    id: "first_blood",
    name: "Первое слово",
    description: "Отправить боту первое сообщение",
    icon: "👋",
  },
  {
    id: "first_tool",
    name: "Первый инструмент",
    description: "Разрешить агенту первый вызов инструмента",
    icon: "🔧",
  },
  {
    id: "first_edit",
    name: "Правка пошла",
    description: "Одобрить первое изменение файла",
    icon: "✏️",
  },
  {
    id: "first_bash",
    name: "Терминал открыт",
    description: "Разрешить первую команду в Bash",
    icon: "🖥️",
  },
  {
    id: "first_deny",
    name: "Нет — тоже ответ",
    description: "Отклонить вызов инструмента",
    icon: "🛑",
  },
  {
    id: "night_owl",
    name: "Ночная смена",
    description: "Написать боту между 02:00 и 05:00",
    icon: "🌙",
  },
  {
    id: "streak_7",
    name: "Неделя подряд",
    description: "Пользоваться ботом 7 дней подряд",
    icon: "🔥",
  },
  { id: "hundred_msgs", name: "Сотня", description: "Отправить 100 сообщений", icon: "💬" },
  { id: "million", name: "Миллион", description: "Потратить 1 000 000 токенов", icon: "🎯" },
  { id: "interrupter", name: "Стоп-кран", description: "Прервать агента на полпути", icon: "⏹️" },
  {
    id: "polyglot",
    name: "Многостаночник",
    description: "Поработать в трёх разных проектах",
    icon: "🗂️",
  },
  { id: "max_cat", name: "Предел", description: "Дорасти до Квантового GPT-кота", icon: "🐈‍⬛" },
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

export function catForMode(cat: CatLevel, engine: "gpt" | "claude"): CatLevel {
 if(engine === "gpt")return cat;
 const names=["Котёнок Claude","Кот-читатель","Кот Haiku","Кот-редактор","Кот-сыщик","Кот Sonnet","Кот-мыслитель","Кот Fable","Кот Opus","Мудрец Claude"];
 const colors=[["#F0C9A9","#B97751"],["#E8B895","#A86142"],["#EAC9B9","#B97D65"],["#DBC3A3","#A3855B"],["#DFA788","#A96044"],["#EDC79E","#B58354"],["#C8B199","#836954"],["#D0B9D2","#876C91"],["#F1D8B3","#B68B51"],["#F2C9AE","#B8734F"]];
 const pair=colors[cat.level-1]!;
 return {...cat,id:"claude-"+cat.id,name:names[cat.level-1]!,palette:[pair[0]!,pair[1]!,"#3C2920"]};
}
