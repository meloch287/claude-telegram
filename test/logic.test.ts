import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.BOT_TOKEN ??= "123456:TEST-TOKEN-FOR-UNIT-TESTS";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.AUTH_MODE ??= "owner";
process.env.OWNER_ANTHROPIC_API_KEY ??= "sk-ant-test";
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
