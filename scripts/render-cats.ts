/**
 * Печатает SVG котов для README.
 *
 * Рисует тем же модулем, что и мини-апп (src/miniapp/public/cat-art.js),
 * поэтому картинки в документации не могут разойтись с тем, что видит
 * пользователь: правка кота автоматически доезжает до README после прогона.
 *
 *   npm run cats
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAT_LEVELS, formatTokens } from "../src/cats.js";
// @ts-expect-error — соседний .js без типов, берём как есть
import { catSvg, claudeStar, COLS, ROWS } from "../src/miniapp/public/cat-art.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_DIR = resolve(ROOT, "docs/cats");
mkdirSync(OUT_DIR, { recursive: true });

// README на GitHub показывается и в светлой, и в тёмной теме, а картинка одна.
// Поэтому у карточек собственный кремовый фон — кот читается на любой подложке.
const CARD_BG = "#FAF9F5";
const CARD_LINE = "#E5DED0";
const INK = "#141413";

// Целые координаты обязательны: при дробном смещении браузер размазывает
// границы клеток и пиксельная сетка перестаёт быть резкой.
const PAD = 2;
const CARD_W = COLS + PAD * 2;
const CARD_H = ROWS + PAD * 2;

/** Убирает внешний <svg>, оставляя содержимое — чтобы вложить в карточку. */
function innerArt(cat: (typeof CAT_LEVELS)[number]): string {
  return catSvg(cat, COLS)
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
}

for (const cat of CAT_LEVELS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}"
     width="${CARD_W * 8}" height="${CARD_H * 8}" shape-rendering="crispEdges"
     role="img" aria-label="${cat.name}: ${cat.title}">
  <title>${cat.name}</title>
  <rect width="${CARD_W}" height="${CARD_H}" rx="2" fill="${CARD_BG}" stroke="${CARD_LINE}"/>
  <g transform="translate(${PAD} ${PAD})">${innerArt(cat)}</g>
</svg>
`;
  writeFileSync(resolve(OUT_DIR, `${cat.level}-${cat.id}.svg`), svg, "utf8");
}

// Общий строй: все десять в ряд, с номерами уровней под каждым.
const CELL = CARD_W + 3;
const HEIGHT = CARD_H + 7;
const parts = CAT_LEVELS.map(
  (cat, index) => `
  <g transform="translate(${index * CELL + 2} 2)">
    <rect width="${CARD_W}" height="${CARD_H}" rx="2" fill="${CARD_BG}" stroke="${CARD_LINE}"/>
    <g transform="translate(${PAD} ${PAD})">${innerArt(cat)}</g>
    <text x="${CARD_W / 2}" y="${CARD_H + 5}" text-anchor="middle" font-family="Georgia, serif"
          font-size="4.5" fill="${INK}">${cat.level}</text>
  </g>`,
);

const width = CELL * CAT_LEVELS.length;
const lineup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${HEIGHT}"
     width="${width * 6}" height="${HEIGHT * 6}" shape-rendering="crispEdges" role="img"
     aria-label="Десять Claude-котов: ${CAT_LEVELS.map((c) => c.name).join(", ")}">
  <title>Десять Claude-котов, от котёнка-стажёра до квантового кота</title>
${parts.join("\n")}
</svg>
`;
writeFileSync(resolve(ROOT, "docs/cats-lineup.svg"), lineup, "utf8");

// Звезда Claude для шапки README.
writeFileSync(resolve(ROOT, "docs/claude-star.svg"), `${claudeStar(84)}\n`, "utf8");

console.log(`Готово: ${CAT_LEVELS.length} котов в docs/cats/, строй и звезда в docs/`);
for (const cat of CAT_LEVELS) {
  console.log(`  ${cat.level}. ${cat.name} — от ${formatTokens(cat.threshold)} токенов`);
}
