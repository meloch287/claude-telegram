import { claudeModels, claudeModelLabel, claudePreferences, CLAUDE_EFFORT_LABELS } from "../claude-settings.js";
import { InlineKeyboard } from "grammy";
import { getChat, getOrCreateUser } from "../db.js";
import { describeKind } from "../auth.js";
import { MODELS } from "./keyboards.js";

/**
 * Экраны бота и переходы между ними.
 *
 * Экраны образуют дерево, поэтому у каждого, кроме корневого, есть родитель — и
 * кнопка «Назад» строится из него автоматически. Один роутер на все переходы:
 * с обработчиком на каждый переход дерево из десяти экранов становится
 * неподдерживаемым уже на третьем.
 *
 * callback_data ограничен 64 байтами, поэтому имена экранов короткие.
 */

export type ScreenId = "menu" | "auth" | "settings" | "mode" | "model" | "thinking";

export interface ScreenView {
  text: string;
  keyboard: InlineKeyboard;
}

export interface ScreenContext {
  userId: number;
  chatId: number;
}

interface Screen {
  parent?: ScreenId;
  render(ctx: ScreenContext): ScreenView;
}

const BACK = "‹ Назад";

const SCREENS: Record<ScreenId, Screen> = {
  menu: {
    render({ userId }) {
      const user = getOrCreateUser(userId);
      const status = user.auth_kind ? `Вход: ${describeKind(user.auth_kind)}` : "Вход не выполнен";

      // Мини-апп живёт на кнопке меню Telegram, рядом с полем ввода.
      // Дублировать его инлайн-кнопкой незачем: она уезжает вверх с историей.
      const keyboard = new InlineKeyboard()
        .text("🤖 GPT", "engine:gpt")
        .text("🧠 Claude", "engine:claude")
        .row()
        .text(user.auth_kind ? "🎫 Аккаунт" : "🎫 Войти", "nav:auth")
        .row()
        .text("⚙️ Настройки", "nav:settings");

      return {
        text: `<b>Клод бот</b>\n\nНапиши задачу или отправь вложение.`,
        keyboard,
      };
    },
  },

  auth: {
    parent: "menu",
    render({ userId }) {
      const user = getOrCreateUser(userId);
      const current = user.auth_kind ? `Сейчас: ${describeKind(user.auth_kind)}\n\n` : "";

      const keyboard = new InlineKeyboard()
        .text("🎫 Подписка Claude", "auth:subscription")
        .row()
        .text("🔌 API-ключ", "auth:api")
        .row();
      if (user.auth_kind) keyboard.text("🚪 Выйти", "auth:logout").row();
      keyboard.text(BACK, "nav:menu");

      return {
        text:
          `${current}<b>Подписка Claude</b> — работа по лимитам твоей подписки, как в обычном Claude Code.\n` +
          `<b>API-ключ</b> — оплата по токенам.`,
        keyboard,
      };
    },
  },

  settings: {
    parent: "menu",
    render({ userId, chatId }) {
      const user = getOrCreateUser(userId);
      const mode = getChat(chatId)?.permission_mode ?? "default";
      const prefs = claudePreferences(userId);
      const model = claudeModels(userId).find(m => m.value === prefs.model)!;
      const modelLabel = claudeModelLabel(model);

      return {
        text: `Режим разрешений: <b>${MODE_LABELS[mode] ?? mode}</b>\nМодель: <b>${modelLabel}</b>`,
        keyboard: new InlineKeyboard()
          .text("🛡️ Режим разрешений", "nav:mode")
          .row()
          .text("🧠 Модель", "nav:model")
          .row()
          .text("Глубина размышления", "nav:thinking")
          .row()
          .text(BACK, "nav:menu"),
      };
    },
  },

  mode: {
    parent: "settings",
    render({ chatId }) {
      const current = getChat(chatId)?.permission_mode ?? "default";
      const keyboard = new InlineKeyboard();
      for (const [id, label] of Object.entries(MODE_LABELS)) {
        keyboard.text(`${label}${id === current ? " ✓" : ""}`, `m:${id}`).row();
      }
      keyboard.text(BACK, "nav:settings");
      return {
        text:
          "Как спрашивать разрешения?\n\n" +
          "<b>⚡ Без вопросов вообще</b> — агент сам правит файлы и запускает команды, " +
          "включая удаление. Ничего не спросит и остановить можно только командой /stop.",
        keyboard,
      };
    },
  },

  thinking: {
    parent: "settings",
    render({ userId }) {
      const prefs = claudePreferences(userId), model = claudeModels(userId).find(m => m.value === prefs.model)!;
      const keyboard = new InlineKeyboard().text(`Как в Claude Code${prefs.effort === null ? " ✓" : ""}`, "ce:default").row();
      for (const level of model.supportedEffortLevels ?? []) keyboard.text(`${CLAUDE_EFFORT_LABELS[level]}${prefs.effort === level ? " ✓" : ""}`, `ce:${level}`).row();
      keyboard.text(`Мышление: ${prefs.thinking === "disabled" ? "выключено" : prefs.thinking === "enabled" ? "включено" : "как в Claude Code"}`, "ct:toggle").row().text(BACK, "nav:settings");
      return { text: "Размышление Claude Code\n\nУровни зависят от выбранной модели. Настройки применяются к следующему сообщению.", keyboard };
    },
  },
  model: {
    parent: "settings",
    render({ userId }) {
      const current = claudePreferences(userId).model;
      const keyboard = new InlineKeyboard();
      for (const model of claudeModels(userId)) {
        const id = model.value, label = claudeModelLabel(model);
        keyboard.text(`${label}${id === current ? " ✓" : ""}`, `md:${id || "default"}`).row();
      }
      keyboard.text(BACK, "nav:settings");
      return { text: "Какой моделью работать?", keyboard };
    },
  },
};

export const MODE_LABELS: Record<string, string> = {
  default: "🛡️ Спрашивать каждый раз",
  acceptEdits: "✏️ Править файлы молча",
  auto: "Автоматическая проверка",
  plan: "🗺️ Только план, без правок",
  bypassPermissions: "⚡ Без вопросов вообще",
};

export function isScreenId(value: string): value is ScreenId {
  return value in SCREENS;
}

export function renderScreen(id: ScreenId, ctx: ScreenContext): ScreenView {
  return SCREENS[id].render(ctx);
}

/** Экран, куда ведёт «Назад». Для корневого — ничего. */
export function parentOf(id: ScreenId): ScreenId | undefined {
  return SCREENS[id].parent;
}
