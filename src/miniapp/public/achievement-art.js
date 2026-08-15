/**
 * Пиксельные значки достижений — тем же языком, что и коты: крупная клетка,
 * сплошная заливка, без обводки, shape-rendering="crispEdges".
 *
 * Эмодзи в мини-аппе выглядели чужеродно: их рисует система, и на каждом
 * телефоне они разные — где-то плоские, где-то объёмные, где-то в другой
 * гамме. Собственные значки держат один стиль везде и совпадают с котами.
 *
 * Сетка 12×12. Символы в спрайтах — ключи палитры:
 *   c — глина (основной тон), d — тёмная глина, i — чернила,
 *   w — крем, y — золото, r — красный, b — синий, g — зелёный
 */

const SIZE = 12;

const PALETTE = {
  c: "#D97757",
  d: "#A84F32",
  i: "#141413",
  w: "#FAF9F5",
  y: "#E0A93B",
  r: "#B23A26",
  b: "#6A9BCC",
  g: "#788C5D",
};

/**
 * Спрайты. Каждый — двенадцать строк по двенадцать клеток; точка это пусто.
 * Рисунок читается на 28 пикселях, поэтому деталей намеренно мало: на такой
 * величине лишняя клетка превращается в грязь.
 */
const SPRITES = {
  // Ладонь: приветствие
  first_blood: [
    "....c.c.....",
    "...cccccc...",
    "..cccccccc..",
    "..cccccccc..",
    ".ccccccccc..",
    "cccccccccc..",
    "cccccccccc..",
    ".ddccccccc..",
    "..dddccccc..",
    "...ddddddd..",
    "....ddddd...",
    "............",
  ],
  // Гаечный ключ
  first_tool: [
    ".....iii....",
    "....i...i...",
    "....i...i...",
    ".....iii....",
    "......ii....",
    ".....ii.....",
    "....ii......",
    "...ii.......",
    "..ii........",
    ".ii.........",
    "ii..........",
    "i...........",
  ],
  // Карандаш
  first_edit: [
    ".........yy.",
    "........yyy.",
    ".......yyy..",
    "......ccc...",
    ".....ccc....",
    "....ccc.....",
    "...ccc......",
    "..ccc.......",
    ".ccc........",
    "www.........",
    "wi..........",
    "i...........",
  ],
  // Окно терминала с приглашением
  first_bash: [
    "iiiiiiiiiiii",
    "i..........i",
    "i.gg.......i",
    "i...gg.....i",
    "i.gg.......i",
    "i..........i",
    "i.gggggg...i",
    "i..........i",
    "i..........i",
    "iiiiiiiiiiii",
    "............",
    "............",
  ],
  // Знак «стоп»: восьмиугольник
  first_deny: [
    "...rrrrrr...",
    "..rrrrrrrr..",
    ".rrrrrrrrrr.",
    "rrrrrrrrrrrr",
    "rrwwwwwwwwrr",
    "rrwwwwwwwwrr",
    "rrrrrrrrrrrr",
    "rrrrrrrrrrrr",
    ".rrrrrrrrrr.",
    "..rrrrrrrr..",
    "...rrrrrr...",
    "............",
  ],
  // Месяц со звездой
  night_owl: [
    "....bbbb....",
    "..bbbbbbbb..",
    ".bbbb....bb.",
    ".bbb........",
    "bbb.......y.",
    "bbb......yyy",
    "bbb.......y.",
    ".bbb........",
    ".bbbb....bb.",
    "..bbbbbbbb..",
    "....bbbb....",
    "............",
  ],
  // Огонь: серия дней
  streak_7: [
    ".....y......",
    "....yy......",
    "...yyyy.....",
    "..yyccyy....",
    "..yccccy....",
    ".yccrrccy...",
    ".ycrrrrcy...",
    ".ycrrrrcy...",
    "..yccrcy....",
    "...yccy.....",
    "....yy......",
    "............",
  ],
  // Облако реплики
  hundred_msgs: [
    ".cccccccccc.",
    "cccccccccccc",
    "cc........cc",
    "cc.wwwwww.cc",
    "cc........cc",
    "cc.wwwwww.cc",
    "cc........cc",
    "cccccccccccc",
    ".ccc.cccccc.",
    "..cc........",
    ".cc.........",
    "............",
  ],
  // Мишень
  million: [
    "...rrrrrr...",
    "..rwwwwwwr..",
    ".rwwrrrrwwr.",
    "rwwrrwwrrwwr",
    "rwrwwiiwwrwr",
    "rwrwiiiiwrwr",
    "rwrwiiiiwrwr",
    "rwrwwiiwwrwr",
    "rwwrrwwrrwwr",
    ".rwwrrrrwwr.",
    "..rwwwwwwr..",
    "...rrrrrr...",
  ],
  // Квадрат «стоп» в круге
  interrupter: [
    "...iiiiii...",
    "..iiiiiiii..",
    ".iiiiiiiiii.",
    "iiiiiiiiiiii",
    "iii.wwww.iii",
    "iii.wwww.iii",
    "iii.wwww.iii",
    "iii.wwww.iii",
    "iiiiiiiiiiii",
    ".iiiiiiiiii.",
    "..iiiiiiii..",
    "...iiiiii...",
  ],
  // Стопка папок
  polyglot: [
    "..cc........",
    ".cccccccccc.",
    ".cccccccccc.",
    ".cccccccccc.",
    "............",
    ".dd.........",
    "dddddddddddd",
    "dddddddddddd",
    "dddddddddddd",
    "............",
    "iiiiiiiiiiii",
    "iiiiiiiiiiii",
  ],
  // Кот в короне: предел
  max_cat: [
    ".y.y.y......",
    ".yyyyy......",
    "............",
    ".ii....ii...",
    ".ii....ii...",
    ".iiiiiiii...",
    ".iwiiiiwi...",
    ".iiiiiiii...",
    ".iiwwwwii...",
    ".ii....ii...",
    ".ii....ii...",
    "............",
  ],
};

/** Значок для тех, кого ещё нет в списке: пустая клетка вместо пропажи. */
const FALLBACK = [
  "............",
  "..iiiiiiii..",
  "..i......i..",
  "..i......i..",
  "..i......i..",
  "..i......i..",
  "..i......i..",
  "..i......i..",
  "..i......i..",
  "..iiiiiiii..",
  "............",
  "............",
];

/** Клетки одного цвета в строке склеиваются в один <rect> — разметка втрое короче. */
function spriteRects(sprite) {
  const rects = [];
  sprite.forEach((row, y) => {
    let x = 0;
    while (x < SIZE) {
      const key = row[x];
      const fill = PALETTE[key];
      if (!fill) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < SIZE && row[x + run] === key) run += 1;
      rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${fill}"/>`);
      x += run;
    }
  });
  return rects.join("");
}

export function achievementSvg(id, size) {
  const sprite = SPRITES[id] ?? FALLBACK;
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" width="${size}" height="${size}"
     xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"
     aria-hidden="true" focusable="false">${spriteRects(sprite)}</svg>`;
}
