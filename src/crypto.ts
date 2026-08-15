import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { config } from "./config.js";

const key = Buffer.from(config.encryptionKey, "base64");
if (key.length !== 32) {
  throw new Error(
    `ENCRYPTION_KEY должен быть 32 байта в base64 (сейчас ${key.length}). Сгенерируй: npm run keygen`,
  );
}

/**
 * AES-256-GCM. Формат хранения: base64(iv | tag | ciphertext).
 * Ключи пользователей не должны лежать в базе открытым текстом — их можно
 * прочитать любым, кто получил файл БД: бэкапом, дампом, украденным диском.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decrypt(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Показываем пользователю только хвост ключа — чтобы он мог опознать, какой из них загружен. */
export function maskKey(apiKey: string): string {
  if (apiKey.length <= 12) return "•".repeat(apiKey.length);
  return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}

/**
 * Проверка initData из Telegram Mini App.
 * Без неё любой может дёрнуть API мини-аппа с чужим user id и посмотреть чужую статистику.
 * Алгоритм из документации Telegram: secret = HMAC_SHA256("WebAppData", bot_token).
 */
export function verifyInitData(initData: string, botToken: string): Record<string, string> | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => [k, v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== computed.length) return null;
  if (!timingSafeEqual(given, computed)) return null;

  // Протухшие initData отбрасываем — иначе перехваченная строка работает вечно.
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 24 * 60 * 60) return null;

  return Object.fromEntries(params.entries());
}
