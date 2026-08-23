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

const MAX_BYTES = 20 * 1024 * 1024;

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
  if ((file.file_size ?? 0) > MAX_BYTES) {
    throw new Error("Файл больше 20 МБ — Telegram не отдаёт такие ботам");
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
