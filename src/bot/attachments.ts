import { fetchTelegramFile } from "./tgFile.js";
import { mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { Api } from "grammy";

/**
 * Вложения из Telegram: фото и файлы кладём в рабочую папку проекта, а агенту
 * сообщаем путь. Читать картинки он умеет сам — инструментом Read.
 *
 * Телеграм отдаёт ботам файлы не больше 20 МБ. Больше — честно говорим, а не
 * молча обрезаем.
 */

/**
 * Потолок в 20 МБ — ограничение ОБЛАЧНОГО Bot API, а не бота.
 *
 * Снимается единственным способом: своим сервером Bot API (telegram-bot-api),
 * где предел поднимается до 2 ГБ, а файл вдобавок кладётся на диск — качать по
 * сети вообще не нужно. Отсюда два режима.
 */
function localApiRoot(): string {
  return (process.env.TELEGRAM_API_ROOT ?? "").trim();
}

const MAX_BYTES_CLOUD = 20 * 1024 * 1024;
const MAX_BYTES_LOCAL = 2000 * 1024 * 1024;

export interface SavedAttachment {
  path: string;
  name: string;
}

/** Имя приходит от пользователя и попадает в путь — режем всё лишнее. */
function safeName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[^\w.\-А-Яа-яЁё ]+/g, "_")
    .replace(/^[.\s]+/, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export async function saveTelegramFile(
  api: Api,
  fileId: string,
  cwd: string,
  suggestedName: string,
): Promise<SavedAttachment> {
  const file = await api.getFile(fileId);
  const local = localApiRoot();
  const limit = local ? MAX_BYTES_LOCAL : MAX_BYTES_CLOUD;
  if ((file.file_size ?? 0) > limit) {
    const mb = Math.round((file.file_size ?? 0) / 1024 / 1024);
    throw new Error(
      local
        ? `Файл ${mb} МБ — больше 2 ГБ не отдаёт даже свой сервер Bot API`
        : `Файл ${mb} МБ. Облачный Bot API отдаёт ботам не больше 20 МБ — это ограничение ` +
          `Telegram, а не бота. Снимается своим сервером Bot API: нужны api_id и api_hash ` +
          `с my.telegram.org.`,
    );
  }
  if (!file.file_path) {
    throw new Error("Telegram не вернул путь к файлу");
  }

  const dir = join(cwd, "вложения");
  mkdirSync(dir, { recursive: true });

  // Имя из file_path сохраняет расширение — по нему агент поймёт тип файла.
  const extension = file.file_path.includes(".")
    ? file.file_path.slice(file.file_path.lastIndexOf("."))
    : "";
  const name = safeName(suggestedName, `${Date.now()}${extension}`);
  const target = join(dir, name);

  const token = api.token;
  const response = await fetchTelegramFile(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok || !response.body) {
    throw new Error(`Не удалось скачать файл: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));

  return { path: target, name };
}
