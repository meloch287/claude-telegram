import { readFileSync } from "node:fs";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";

/**
 * MCP-серверы из файла в формате Claude Code:
 *
 *   { "mcpServers": { "имя": { "command": "npx", "args": ["-y", "пакет"] } } }
 *
 * Тот же файл, что кладут в ~/.claude.json, поэтому конфигурацию можно принести
 * с рабочей машины как есть.
 */
export function loadMcpServers(): Record<string, McpServerConfig> {
  if (!config.mcpConfigPath) return {};
  try {
    const raw = JSON.parse(readFileSync(config.mcpConfigPath, "utf8")) as {
      mcpServers?: Record<string, McpServerConfig>;
    };
    const servers = raw.mcpServers ?? {};
    const names = Object.keys(servers);
    if (names.length > 0) console.log(`🔌 MCP-серверы: ${names.join(", ")}`);
    return servers;
  } catch (error) {
    // Ошибку в конфиге нельзя проглатывать: пользователь будет думать, что
    // серверы подключены, а их нет.
    console.error(`⚠️  Не прочитать ${config.mcpConfigPath}:`, error);
    return {};
  }
}
