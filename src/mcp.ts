import { readFileSync } from "node:fs";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";

/**
 * Подставляет ${ПЕРЕМЕННАЯ} из окружения.
 *
 * Без этого токен пришлось бы вписывать в файл конфигурации, а он лежит в
 * репозитории. Ненайденная переменная превращается в пустую строку — сервер
 * тогда честно не подключится, вместо того чтобы уйти в запрос со строкой
 * «${GITHUB_TOKEN}» вместо ключа.
 */
export function expandVars(value: string, env: NodeJS.ProcessEnv = process.env): string {
  // Имя переменной берём любое, а не только латиницей: иначе неподошедшее
  // ${…} осталось бы в строке дословно и уехало бы в запрос вместо ключа —
  // то есть ровно тот случай, который здесь и предотвращается.
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => env[name.trim()] ?? "");
}

function expandDeep<T>(value: T, env: NodeJS.ProcessEnv): T {
  if (typeof value === "string") return expandVars(value, env) as T;
  if (Array.isArray(value)) return value.map((item) => expandDeep(item, env)) as T;
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = expandDeep(item, env);
    return result as T;
  }
  return value;
}

/**
 * MCP-серверы из файла в формате Claude Code:
 *
 *   { "mcpServers": { "имя": { "type": "http", "url": "…" } } }
 *
 * Тот же файл, что кладут в ~/.claude.json, поэтому конфигурацию можно принести
 * с рабочей машины как есть.
 */
export function loadMcpServers(
  path: string = config.mcpConfigPath,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, McpServerConfig> {
  if (!path) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers?: Record<string, McpServerConfig>;
    };
    const servers = expandDeep(raw.mcpServers ?? {}, env);
    const names = Object.keys(servers);
    if (names.length > 0) console.log(`🔌 MCP-серверы: ${names.join(", ")}`);
    return servers;
  } catch (error) {
    // Ошибку в конфиге нельзя проглатывать: пользователь будет думать, что
    // серверы подключены, а их нет.
    console.error(`⚠️  Не прочитать ${path}:`, error);
    return {};
  }
}
