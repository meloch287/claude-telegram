import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.BOT_TOKEN ??= "123456:TEST-TOKEN-FOR-UNIT-TESTS";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.DATA_DIR ??= "./data/test";
process.env.WORKSPACE_ROOT ??= "./workspaces/test";

const { encrypt, decrypt, maskKey, verifyInitData } = await import("../src/crypto.js");
const { MessageQueue } = await import("../src/agent/queue.js");
const { catForTokens, nextCat, catProgress, CAT_LEVELS } = await import("../src/cats.js");
const { sanitizeProject, workspaceFor } = await import("../src/bot/session.js");
const { chunk, truncate, splitCodeBlocks, codeBlockFileName } = await import("../src/agent/render.js");
const { snapshot, changedSince, formatSize } = await import("../src/bot/artifacts.js");

test("шифрование ключей: круговой рейс", () => {
  const original = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
  const stored = encrypt(original);
  assert.notEqual(stored, original, "ключ не должен лежать открытым текстом");
  assert.equal(decrypt(stored), original);
});

test("шифрование: два вызова дают разный шифротекст (свежий IV)", () => {
  assert.notEqual(encrypt("одно и то же"), encrypt("одно и то же"));
});

test("шифрование: испорченный шифротекст не расшифровывается", () => {
  const stored = encrypt("секрет");
  const buf = Buffer.from(stored, "base64");
  buf[buf.length - 1] ^= 0xff;
  assert.throws(() => decrypt(buf.toString("base64")));
});

test("маска ключа не раскрывает середину", () => {
  const masked = maskKey("sk-ant-api03-SECRETSECRETSECRET1234");
  assert.ok(masked.startsWith("sk-ant-"));
  assert.ok(masked.endsWith("1234"));
  assert.ok(!masked.includes("SECRETSECRET"));
});

// ── initData ────────────────────────────────────────────────────────────────

function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

const BOT_TOKEN = process.env.BOT_TOKEN!;

test("initData: корректная подпись принимается", () => {
  const initData = signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "AAA",
      user: JSON.stringify({ id: 42, first_name: "Саша" }),
    },
    BOT_TOKEN,
  );
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.ok(result, "валидные initData должны пройти проверку");
  assert.equal(JSON.parse(result.user!).id, 42);
});

test("initData: подделанный user отклоняется", () => {
  const initData = signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 42 }),
    },
    BOT_TOKEN,
  );
  const tampered = initData.replace(encodeURIComponent('{"id":42}'), encodeURIComponent('{"id":9}'));
  assert.equal(verifyInitData(tampered, BOT_TOKEN), null);
});

test("initData: чужой токен отклоняется", () => {
  const initData = signInitData(
    { auth_date: String(Math.floor(Date.now() / 1000)), user: "{}" },
    "999:OTHER",
  );
  assert.equal(verifyInitData(initData, BOT_TOKEN), null);
});

test("initData: протухшие данные отклоняются", () => {
  const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
  const initData = signInitData({ auth_date: String(twoDaysAgo), user: "{}" }, BOT_TOKEN);
  assert.equal(verifyInitData(initData, BOT_TOKEN), null);
});

// ── Очередь streaming input ─────────────────────────────────────────────────

test("очередь: отдаёт то, что положили до начала чтения", async () => {
  const queue = new MessageQueue<number>();
  queue.push(1);
  queue.push(2);
  queue.close();
  const seen: number[] = [];
  for await (const item of queue) seen.push(item);
  assert.deepEqual(seen, [1, 2]);
});

test("очередь: читатель ждёт элемент, который положат позже", async () => {
  const queue = new MessageQueue<string>();
  const seen: string[] = [];
  const reader = (async () => {
    for await (const item of queue) {
      seen.push(item);
      if (seen.length === 2) queue.close();
    }
  })();
  setTimeout(() => queue.push("первое"), 5);
  setTimeout(() => queue.push("второе"), 10);
  await reader;
  assert.deepEqual(seen, ["первое", "второе"]);
});

test("очередь: close завершает ожидающего читателя", async () => {
  const queue = new MessageQueue<number>();
  const reader = (async () => {
    for await (const _ of queue) {
      /* ничего не придёт */
    }
    return "завершился";
  })();
  setTimeout(() => queue.close(), 5);
  assert.equal(await reader, "завершился");
});

// ── Уровни котов ────────────────────────────────────────────────────────────

test("коты: пороги монотонно растут", () => {
  for (let i = 1; i < CAT_LEVELS.length; i += 1) {
    assert.ok(
      CAT_LEVELS[i]!.threshold > CAT_LEVELS[i - 1]!.threshold,
      `порог уровня ${i + 1} должен быть больше предыдущего`,
    );
  }
});

test("коты: нулевой расход даёт первый уровень", () => {
  assert.equal(catForTokens(0).level, 1);
});

test("коты: ровно на пороге уровень уже открыт", () => {
  const third = CAT_LEVELS[2]!;
  assert.equal(catForTokens(third.threshold).level, third.level);
  assert.equal(catForTokens(third.threshold - 1).level, third.level - 1);
});

test("коты: за последним порогом прогресс равен единице", () => {
  const last = CAT_LEVELS[CAT_LEVELS.length - 1]!;
  assert.equal(nextCat(last.threshold + 1), null);
  assert.equal(catProgress(last.threshold + 1), 1);
});

test("коты: прогресс внутри уровня считается от его начала", () => {
  const first = CAT_LEVELS[0]!;
  const second = CAT_LEVELS[1]!;
  const middle = (first.threshold + second.threshold) / 2;
  const progress = catProgress(middle);
  assert.ok(progress > 0.4 && progress < 0.6, `ожидал около 0.5, получил ${progress}`);
});

// ── Имена проектов ──────────────────────────────────────────────────────────

test("проекты: обход каталога вверх не проходит", () => {
  assert.equal(sanitizeProject("../../etc"), "etc");
  assert.equal(sanitizeProject("..\\..\\windows"), "windows");
  assert.equal(sanitizeProject("/absolute/path"), "absolute-path");
});

test("проекты: пустое имя превращается в default", () => {
  assert.equal(sanitizeProject("   "), "default");
  assert.equal(sanitizeProject("..."), "default");
  assert.equal(sanitizeProject("///"), "default");
});

test("проекты: рабочая папка всегда внутри каталога пользователя", () => {
  const dir = workspaceFor(777, "../../../tmp/evil");
  assert.ok(dir.includes(`${777}`), `путь должен остаться в папке пользователя: ${dir}`);
  assert.ok(!dir.includes(".."), `в пути не должно быть переходов вверх: ${dir}`);
});

// ── Разбиение сообщений ─────────────────────────────────────────────────────

test("разбиение: короткий текст не трогаем", () => {
  assert.deepEqual(chunk("привет"), ["привет"]);
});

test("разбиение: длинный текст режется по границам строк и собирается обратно", () => {
  const text = Array.from({ length: 500 }, (_, i) => `строка номер ${i}`).join("\n");
  const parts = chunk(text, 1000);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(part.length <= 1000, `кусок длиннее лимита: ${part.length}`);
  assert.equal(parts.join("\n").replace(/\n+/g, "\n"), text.replace(/\n+/g, "\n"));
});

test("разбиение: строка без переносов всё равно режется", () => {
  const parts = chunk("а".repeat(5000), 1000);
  assert.ok(parts.length >= 5);
  for (const part of parts) assert.ok(part.length <= 1000);
});

test("обрезка сообщает, сколько символов скрыто", () => {
  const result = truncate("а".repeat(100), 10);
  assert.ok(result.startsWith("а".repeat(10)));
  assert.ok(result.includes("90"));
});

// ── Выбор канала выхода ─────────────────────────────────────────────────────

const { parsePool, hideCredentials } = await import("../src/proxy.js");

test("пул: пустая строка и пустое окружение дают пустой список", () => {
  assert.deepEqual(parsePool("", {}), []);
});

test("пул: порядок в строке задаёт приоритет", () => {
  const pool = parsePool("http://a:1,http://b:2", {});
  assert.deepEqual(pool.map((c) => c.url), ["http://a:1", "http://b:2"]);
});

test("пул: прокси из окружения попадает в конец, а не теряется", () => {
  const pool = parsePool("http://a:1", { HTTPS_PROXY: "http://env:9" });
  assert.deepEqual(pool.map((c) => c.url), ["http://a:1", "http://env:9"]);
});

test("пул: прокси из окружения не дублируется, если уже в списке", () => {
  const pool = parsePool("http://same:1", { HTTPS_PROXY: "http://same:1" });
  assert.equal(pool.length, 1);
});

test("пароль прокси не утекает в логи", () => {
  const masked = hideCredentials("http://user:s3cret@de1.example:8080");
  assert.ok(!masked.includes("s3cret"));
  assert.ok(!masked.includes("user"));
  assert.ok(masked.includes("de1.example:8080"));
});

// ── Распознавание секретов ──────────────────────────────────────────────────

const { detectKind, looksLikeOauthToken, looksLikeApiKey } = await import("../src/auth.js");

test("токен подписки не принимается за ключ API", () => {
  // Ровно эта путаница ломала бота: шаблон ключа шире и накрывает токен.
  const token = "sk-ant-oat01-" + "a".repeat(40);
  assert.equal(detectKind(token), "subscription");
  assert.equal(looksLikeApiKey(token), false);
});

test("ключ API распознаётся как ключ", () => {
  const key = "sk-ant-api03-" + "b".repeat(40);
  assert.equal(detectKind(key), "api");
  assert.equal(looksLikeOauthToken(key), false);
});

test("мусор не распознаётся никак", () => {
  assert.equal(detectKind("просто текст"), null);
  assert.equal(detectKind("sk-ant-"), null);
});

// ── Имена вложений ──────────────────────────────────────────────────────────

const { saveTelegramFile } = await import("../src/bot/attachments.js");

test("вложения: модуль экспортирует сохранение файла", () => {
  assert.equal(typeof saveTelegramFile, "function");
});

// ── Репозитории ─────────────────────────────────────────────────────────────

const { hideToken } = await import("../src/bot/repos.js");

test("токен из адреса репозитория не утекает в сообщение об ошибке", () => {
  const masked = hideToken("fatal: не удалось https://ghp_SECRET123@github.com/user/repo");
  assert.ok(!masked.includes("ghp_SECRET123"));
  assert.ok(masked.includes("github.com/user/repo"));
});

// ── Длинный код уходит файлом ────────────────────────────────────────────────

test("короткий блок кода остаётся в сообщении", () => {
  const text = "Вот исправление:\n```ts\nconst a = 1;\n```\nГотово.";
  const parts = splitCodeBlocks(text);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "text");
});

test("длинный блок кода отделяется в файл", () => {
  const body = "const x = 1;\n".repeat(200);
  const parts = splitCodeBlocks(`Смотри:\n\`\`\`ts\n${body}\`\`\`\nВсё.`);
  const kinds = parts.map((p) => p.kind);
  assert.deepEqual(kinds, ["text", "file", "text"]);
  assert.equal(parts[1]?.language, "ts");
  assert.ok(parts[1]?.body.includes("const x = 1;"));
});

test("имя файла берётся из языка блока", () => {
  assert.equal(codeBlockFileName("python", 1), "фрагмент-1.py");
  assert.equal(codeBlockFileName("typescript", 2), "фрагмент-2.ts");
  assert.equal(codeBlockFileName(undefined, 3), "фрагмент-3.txt");
});

// ── Файлы, созданные агентом ─────────────────────────────────────────────────

test("новые и изменённые файлы находятся, нетронутые — нет", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const root = mkdtempSync(join(tmpdir(), "артефакты-"));
  writeFileSync(join(root, "старый.txt"), "было");
  const before = snapshot(root);

  writeFileSync(join(root, "новый.md"), "результат работы");
  // Разрешение mtime на некоторых файловых системах — секунда, поэтому
  // изменение помечаем явным временем, а не надеемся на часы.
  const { utimesSync } = await import("node:fs");
  utimesSync(join(root, "старый.txt"), new Date(), new Date(Date.now() + 5000));

  const changed = changedSince(root, before);
  const names = changed.map((f) => f.relative).sort();
  assert.deepEqual(names, ["новый.md", "старый.txt"]);
  // Новые идут первыми: они интереснее.
  assert.equal(changed[0]?.relative, "новый.md");
  assert.equal(changed[0]?.isNew, true);
});

test("зависимости в отпечаток не попадают", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const root = mkdtempSync(join(tmpdir(), "артефакты-"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules", "пакет.js"), "x");
  writeFileSync(join(root, "мой.js"), "x");

  const seen = [...snapshot(root).keys()];
  assert.deepEqual(seen, ["мой.js"]);
});

test("размер файла читается по-русски", () => {
  assert.equal(formatSize(512), "512 Б");
  assert.equal(formatSize(2048), "2 КБ");
  assert.equal(formatSize(3 * 1024 * 1024), "3.0 МБ");
});

// ── /file не выпускает за пределы проекта ────────────────────────────────────

test("путь наружу рабочей папки отбивается", async () => {
  const { resolve, sep } = await import("node:path");
  const cwd = "/workspaces/пользователь/проект";
  const inside = (requested: string) => {
    const target = resolve(cwd, requested);
    return target === cwd || target.startsWith(cwd + sep);
  };

  assert.equal(inside("отчёт.md"), true);
  assert.equal(inside("вложенная/папка/файл.ts"), true);
  assert.equal(inside("../../.env"), false);
  assert.equal(inside("/etc/passwd"), false);
  // Ловушка на префикс: соседняя папка начинается так же, но это не наша.
  assert.equal(inside("../проект-чужой/секрет"), false);
});

test("массовая операция не выдаётся за результат работы", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { reportChanges } = await import("../src/bot/artifacts.js");

  const root = mkdtempSync(join(tmpdir(), "клон-"));
  const before = snapshot(root);
  // Клон репозитория выглядит именно так: много файлов разом.
  for (let i = 0; i < 60; i += 1) writeFileSync(join(root, `файл-${i}.ts`), "x");

  const report = reportChanges(root, before);
  assert.equal(report.bulk, true);
  assert.equal(report.total, 60);
  assert.deepEqual(report.files, [], "при массовой операции файлы в чат не идут");
});

test("картинки уходят фотографией, остальное документом", async () => {
  const { isImage } = await import("../src/bot/output.js");
  assert.equal(isImage("график.png"), true);
  assert.equal(isImage("/путь/скриншот.JPEG"), true);
  assert.equal(isImage("анимация.gif"), true);
  assert.equal(isImage("отчёт.pdf"), false);
  assert.equal(isImage("код.ts"), false);
  // Telegram не принимает SVG как фото — он должен уйти документом.
  assert.equal(isImage("схема.svg"), false);
});

// ── Вывод инструментов ───────────────────────────────────────────────────────

test("результат инструмента собирается из строки и из блоков", async () => {
  const { flattenToolResult } = await import("../src/agent/conversation.js");
  assert.equal(flattenToolResult("  вывод команды  "), "вывод команды");
  assert.equal(
    flattenToolResult([{ type: "text", text: "первая" }, { type: "text", text: "вторая" }]),
    "первая\nвторая",
  );
  // Картинки и прочее в текст не превращаем — только выкидываем.
  assert.equal(flattenToolResult([{ type: "image", source: {} }]), "");
  assert.equal(flattenToolResult(undefined), "");
});

test("длинный вывод команды режется с начала, а не с конца", async () => {
  const { preBlock } = await import("../src/agent/conversation.js");
  // У команд важен хвост: ошибка и итог печатаются последними.
  const output = [...Array(200)].map((_, i) => `строка ${i}`).join("\n");
  const rendered = preBlock(output, 300);
  assert.ok(rendered.includes("строка 199"), "конец вывода должен остаться");
  assert.ok(!rendered.includes("строка 0\n"), "начало должно быть срезано");
  assert.ok(rendered.includes("начало срезано"), "обрезка должна быть явной");
});

// ── MCP-конфигурация ─────────────────────────────────────────────────────────

test("переменные окружения подставляются в конфиг MCP", async () => {
  const { expandVars } = await import("../src/mcp.js");
  const env = { GITHUB_TOKEN: "ghp_секрет", EMPTY: "" };
  assert.equal(expandVars("Bearer ${GITHUB_TOKEN}", env), "Bearer ghp_секрет");
  assert.equal(expandVars("https://api/${GITHUB_TOKEN}/x", env), "https://api/ghp_секрет/x");
  // Ненайденная переменная не должна уехать в запрос как есть.
  assert.equal(expandVars("Bearer ${НЕТ_ТАКОЙ}", env), "Bearer ");
  assert.equal(expandVars("без переменных", env), "без переменных");
});

test("конфиг MCP читается и разворачивается целиком", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadMcpServers } = await import("../src/mcp.js");

  const dir = mkdtempSync(join(tmpdir(), "mcp-"));
  const file = join(dir, "mcp.json");
  writeFileSync(
    file,
    JSON.stringify({
      mcpServers: {
        сервер: { type: "http", url: "https://x/mcp", headers: { Authorization: "Bearer ${ТОКЕН}" } },
      },
    }),
  );

  const servers = loadMcpServers(file, { ТОКЕН: "тайна" });
  const server = servers["сервер"] as { headers?: Record<string, string> };
  assert.equal(server.headers?.Authorization, "Bearer тайна");
});

test("сломанный конфиг MCP не роняет бота", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadMcpServers } = await import("../src/mcp.js");

  const dir = mkdtempSync(join(tmpdir(), "mcp-"));
  const file = join(dir, "битый.json");
  writeFileSync(file, "{ это не json");
  assert.deepEqual(loadMcpServers(file, {}), {});
  // Отсутствующий файл — тоже не повод падать.
  assert.deepEqual(loadMcpServers(join(dir, "нет.json"), {}), {});
});

test("настоящий mcp.json проекта валиден", async () => {
  const { loadMcpServers } = await import("../src/mcp.js");
  const servers = loadMcpServers("mcp.json", {});
  const names = Object.keys(servers).sort();
  assert.deepEqual(names, ["context7", "deepwiki"]);
  for (const name of names) {
    const server = servers[name] as { type?: string; url?: string };
    assert.equal(server.type, "http", `${name} должен ходить по http`);
    assert.ok(server.url?.startsWith("https://"), `${name} должен быть по https`);
  }
});

// ── Копии базы ────────────────────────────────────────────────────────────
// Ломается незаметно: копия либо не снимается вовсе, либо снимается битой.
// Проверяем, что снимок читается как настоящая база и данные в нём те же.

test("копия базы: снимается, читается и содержит те же строки", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdirSync, rmSync, existsSync } = await import("node:fs");
  const { join, resolve } = await import("node:path");

  const dataDir = resolve(process.cwd(), process.env.DATA_DIR ?? "./data/test");
  mkdirSync(dataDir, { recursive: true });
  rmSync(join(dataDir, "backups"), { recursive: true, force: true });

  // Пишем в ту же базу, которую снимает backupNow: путь берётся из конфига.
  const db = new DatabaseSync(join(dataDir, "bot.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS proba (id INTEGER PRIMARY KEY, note TEXT)");
  db.exec("DELETE FROM proba");
  db.prepare("INSERT INTO proba (id, note) VALUES (?, ?)").run(1, "строка до копии");
  db.close();

  const { backupNow } = await import("../src/backup.js");
  const made = backupNow();
  assert.ok(made, "первая копия за сутки должна сниматься");
  assert.ok(existsSync(made), "файл копии должен появиться на диске");

  const copy = new DatabaseSync(made, { readOnly: true });
  const row = copy.prepare("SELECT note FROM proba WHERE id = 1").get() as { note: string };
  assert.equal(row.note, "строка до копии", "данные в копии должны совпадать с оригиналом");
  copy.close();

  assert.equal(backupNow(), null, "вторая копия за те же сутки не нужна");

  rmSync(join(dataDir, "backups"), { recursive: true, force: true });
});

// findRepos решает, с чем работают /diff, /commit и /push. Ошибётся — команды
// уйдут не в тот репозиторий или скажут «нечего коммитить» при изменениях.
test("поиск репозитория: корень, подпапка, несколько, пусто", async () => {
  const { mkdirSync, rmSync } = await import("node:fs");
  const { join, resolve } = await import("node:path");
  const { findRepos } = await import("../src/bot/git.js");

  const root = resolve(process.cwd(), "workspaces/test/repos-proba");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  assert.deepEqual(findRepos(root), [], "в пустой папке репозиториев нет");
  assert.deepEqual(findRepos(join(root, "нет-такой")), [], "несуществующая папка не роняет");

  mkdirSync(join(root, "один", ".git"), { recursive: true });
  assert.deepEqual(findRepos(root), [join(root, "один")], "репозиторий в подпапке находится");

  mkdirSync(join(root, "два", ".git"), { recursive: true });
  assert.equal(findRepos(root).length, 2, "оба репозитория видны — выбирать будет пользователь");

  // Сам проект тоже может быть репозиторием: тогда подпапки не при чём.
  mkdirSync(join(root, ".git"), { recursive: true });
  assert.deepEqual(findRepos(root), [root], "корень перебивает подпапки");

  rmSync(root, { recursive: true, force: true });
});

// Доводка статистики выполняется один раз при открытии базы, поэтому проверять
// её приходится в отдельном процессе: db.ts — синглтон, второй раз в этом же
// процессе он не переинициализируется.
test("разделение статистики: импорт отделяется от расхода бота", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { fileURLToPath } = await import("node:url");

  const dir = mkdtempSync(join(tmpdir(), "split-"));
  const dbPath = fileURLToPath(new URL("../src/db.ts", import.meta.url));
  const script = join(dir, "проба.mjs");

  writeFileSync(
    script,
    `
    process.env.BOT_TOKEN = "1:T";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    process.env.DATA_DIR = ${JSON.stringify(dir)};
    process.env.WORKSPACE_ROOT = ${JSON.stringify(join(dir, "ws"))};

    const { DatabaseSync } = await import("node:sqlite");
    const seed = new DatabaseSync(${JSON.stringify(join(dir, "bot.db"))});
    seed.exec("CREATE TABLE users (user_id INTEGER PRIMARY KEY, api_key_enc TEXT, auth_kind TEXT, model TEXT, onboarded INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_active_day TEXT, streak_days INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0, total_cost_usd REAL NOT NULL DEFAULT 0, total_messages INTEGER NOT NULL DEFAULT 0, total_sessions INTEGER NOT NULL DEFAULT 0, tools_allowed INTEGER NOT NULL DEFAULT 0, tools_denied INTEGER NOT NULL DEFAULT 0)");
    seed.exec("CREATE TABLE usage_daily (user_id INTEGER NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))");
    seed.prepare("INSERT INTO users (user_id, created_at, total_tokens, total_messages) VALUES (?,?,?,?)").run(5, Date.now(), 1000000, 900);
    seed.prepare("INSERT INTO usage_daily VALUES (?,?,?,?)").run(5, "2026-08-14", 2500, 0.5);
    // Второй пользователь наработал всё сам: истории у него быть не должно.
    seed.prepare("INSERT INTO users (user_id, created_at, total_tokens, total_messages) VALUES (?,?,?,?)").run(6, Date.now(), 700, 3);
    seed.prepare("INSERT INTO usage_daily VALUES (?,?,?,?)").run(6, "2026-08-14", 700, 0.1);
    seed.close();

    const db = await import(${JSON.stringify(dbPath)});
    const a = db.getOrCreateUser(5);
    const b = db.getOrCreateUser(6);
    console.log(JSON.stringify({
      импорт: a.history_tokens,
      бот: a.total_tokens - a.history_tokens,
      всего: a.total_tokens,
      свой: b.history_tokens,
    }));
    `,
  );

  const out = execFileSync("npx", ["tsx", script], { encoding: "utf8" });
  const result = JSON.parse(out.trim().split("\n").pop() ?? "{}");
  rmSync(dir, { recursive: true, force: true });

  assert.equal(result.импорт, 997_500, "импортом считается всё, чего нет в подённом расходе");
  assert.equal(result.бот, 2_500, "боту достаётся ровно то, что он записал по дням");
  assert.equal(result.всего, 1_000_000, "сумма не должна меняться: кот считается по ней");
  assert.equal(result.свой, 0, "у того, кто наработал всё сам, истории нет");
});
