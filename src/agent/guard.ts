import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionBridgeHooks } from "./permissions.js";
import { requestDecision } from "./permissions.js";

/**
 * Сторож необратимого.
 *
 * В режиме «правки без вопросов» (bypassPermissions) SDK одобряет каждый вызов
 * инструмента ДО того, как позовут canUseTool, — он об этом честно пишет в лог:
 * «canUseTool will not be invoked». То есть весь механизм карточек в этом
 * режиме выключен, включая кнопку «Стоп». Пользователь при этом уверен, что на
 * `rm -rf` его всё-таки переспросят.
 *
 * PreToolUse срабатывает раньше и работает во всех режимах. Гейтить им всё
 * подряд бессмысленно — тогда режим «без вопросов» перестанет быть собой.
 * Поэтому здесь короткий список того, что необратимо или задевает сам сервис:
 * такое спрашивается всегда, в любом режиме.
 */

export interface DangerMatch {
  /** Короткое объяснение, почему спрашиваем. Уходит пользователю в карточку. */
  reason: string;
}

interface Rule {
  reason: string;
  test: RegExp;
}

/**
 * Правила для Bash. Намеренно узкие: широкий шаблон переспрашивал бы на каждой
 * второй команде, к нему быстро привыкают и жмут «разрешить» не глядя — а это
 * хуже, чем не спрашивать вовсе.
 */
const BASH_RULES: Rule[] = [
  {
    reason: "рекурсивное удаление за пределами проекта",
    test: /\brm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rR][a-zA-Z]*f?[a-zA-Z]*\s+(\/(?!tmp\/)|~|\$HOME|\.\.)/,
  },
  { reason: "удаление истории git", test: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+[^|;&]*\.git(\s|$|\/)/ },
  {
    reason: "разметка или перезапись диска",
    test: /\b(mkfs|fdisk|parted)\b|\bdd\s+[^|;&]*of=\/dev\//,
  },
  { reason: "выключение или перезагрузка машины", test: /\b(shutdown|reboot|halt|poweroff)\b/ },
  {
    reason: "остановка или удаление контейнеров",
    test: /\bdocker(\s+compose)?\s+(rm|kill|stop|down|prune|system\s+prune)\b/,
  },
  { reason: "вмешательство в системные службы", test: /\bsystemctl\s+(stop|disable|mask)\b/ },
  { reason: "работа от root", test: /(^|[|;&]\s*)sudo\b|\bsu\s+-\b/ },
  {
    reason: "переписывание истории на сервере",
    test: /\bgit\s+push\b[^|;&]*(--force\b|--force-with-lease\b|\s-f(\s|$))/,
  },
  {
    reason: "скачанный код сразу в оболочку",
    test: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/,
  },
  { reason: "раздача прав всем на всё", test: /\bchmod\s+(-[a-zA-Z]+\s+)*777\b/ },
  { reason: "остановка процесса инициализации", test: /\bkill\s+(-9\s+)?1(\s|$)/ },
  {
    reason: "чтение секретов наружу",
    test: /\.env\b[^|;&]*\|\s*(curl|wget|nc)\b|\b(curl|wget)\b[^|;&]*--data[^|;&]*\.env\b/,
  },
];

/** Пути, которые нельзя трогать молча: на них держится сам бот. */
const PROTECTED_PATH =
  /(^|\/)(\.env|\.git\/config|settings\.local\.json|bot\.db)$|^\/(etc|usr|bin|sbin|boot|var\/lib)\//;

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Что именно тут опасного. null — обычный вызов, спрашивать не о чем. */
export function findDanger(toolName: string, input: Record<string, unknown>): DangerMatch | null {
  if (toolName === "Bash") {
    const command = textOf(input.command);
    for (const rule of BASH_RULES) {
      if (rule.test.test(command)) return { reason: rule.reason };
    }
    return null;
  }

  if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
    const path = textOf(input.file_path) || textOf(input.path) || textOf(input.notebook_path);
    if (path && PROTECTED_PATH.test(path)) {
      return { reason: "правка файла, от которого зависит сам сервис" };
    }
  }
  return null;
}

export interface DangerGuardOptions {
  chatId: number;
  timeoutMs: number;
  hooks: PermissionBridgeHooks;
  /** Текущий режим разрешений. В обычных режимах спрашивает canUseTool. */
  currentMode: () => string;
}

/**
 * Хук PreToolUse. В обычных режимах молчит и пропускает решение дальше — иначе
 * пользователь получал бы две карточки на одно действие.
 */
export function createDangerGuard(options: DangerGuardOptions) {
  const { chatId, timeoutMs, hooks, currentMode } = options;

  return async function preToolUse(
    input: unknown,
    toolUseId: string | undefined,
    context: { signal: AbortSignal },
  ): Promise<HookJSONOutput> {
    const event = input as { tool_name?: string; tool_input?: unknown };
    const toolName = event.tool_name ?? "";
    const toolInput = (event.tool_input ?? {}) as Record<string, unknown>;

    // Спрашиваем только там, где карточек не будет: в остальных режимах
    // canUseTool сделает это сам и лучше — у него есть «всегда разрешать».
    if (currentMode() !== "bypassPermissions") return {};

    const danger = findDanger(toolName, toolInput);
    if (!danger) return {};

    const decision = await requestDecision({
      chatId,
      toolName,
      input: toolInput,
      timeoutMs,
      hooks,
      signal: context.signal,
      title: `Опасное действие: ${danger.reason}`,
      description: "Режим «без вопросов» включён, но это действие необратимо, поэтому спрашиваю.",
      toolUseID: toolUseId ?? "pre-tool-use",
    });

    if (decision.kind === "allow" || decision.kind === "allow_always") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Пользователь подтвердил кнопкой",
        },
      };
    }

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          decision.kind === "stop"
            ? "Пользователь остановил работу"
            : (decision.message ?? "Пользователь отклонил это действие"),
      },
    };
  };
}
