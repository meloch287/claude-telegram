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

export type ScreenId = "menu" | "auth" | "settings" | "mode" | "model";

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
      const status = user.auth_kind
        ? `Вход: ${describeKind(user.auth_kind)}`
        : "Вход не выполнен";

      // Мини-апп живёт на кнопке меню Telegram, рядом с полем ввода.
      // Дублировать его инлайн-кнопкой незачем: она уезжает вверх с историей.
      const keyboard = new InlineKeyboard()
        .text(user.auth_kind ? "🎫 Аккаунт" : "🎫 Войти", "nav:auth")
        .row()
        .text("⚙️ Настройки", "nav:settings");

      return {
        text: `<b>Claude Code в Telegram</b>\n\n${status}\n\nНапиши задачу текстом — агент возьмётся за неё.`,
        keyboard,
      };
    },
  },

  auth: {
    parent: "menu",
    render({ userId }) {
      const user = getOrCreateUser(userId);
      const current = user.auth_kind
        ? `Сейчас: ${describeKind(user.auth_kind)}\n\n`
        : "";

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
      const modelLabel = MODELS.find(([id]) => id === (user.model ?? ""))?.[1] ?? user.model;

      return {
        text: `Режим разрешений: <b>${MODE_LABELS[mode] ?? mode}</b>\nМодель: <b>${modelLabel}</b>`,
        keyboard: new InlineKeyboard()
          .text("🛡️ Режим разрешений", "nav:mode")
          .row()
          .text("🧠 Модель", "nav:model")
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

  model: {
    parent: "settings",
    render({ userId }) {
      const current = getOrCreateUser(userId).model ?? "";
      const keyboard = new InlineKeyboard();
      for (const [id, label] of MODELS) {
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
