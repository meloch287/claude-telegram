import type { Api } from "grammy";
import { GrammyError } from "grammy";
import type { ConversationOutput } from "../agent/conversation.js";
import type { PendingPermission, PendingQuestion, PermissionBridgeHooks } from "../agent/permissions.js";
import { permissionKeyboard, questionKeyboard } from "./keyboards.js";
import { describeToolDetailed, esc, toolIcon, TELEGRAM_LIMIT } from "../agent/render.js";

/** Игнорируем ошибки, которые ничего не значат для пользователя. */
function isBenignEditError(error: unknown): boolean {
  if (!(error instanceof GrammyError)) return false;
  const description = error.description ?? "";
  return (
    description.includes("message is not modified") ||
    description.includes("message to edit not found") ||
    description.includes("message can't be edited")
  );
}

export class TelegramOutput implements ConversationOutput {
  #api: Api;
  #chatId: number;
  #statusMessageId: number | null = null;
  #streamMessageId: number | null = null;
  #streamShown = "";
  #lastStreamEdit = 0;

  constructor(api: Api, chatId: number) {
    this.#api = api;
    this.#chatId = chatId;
  }

  async send(html: string): Promise<number | undefined> {
    if (!html.trim()) return undefined;
    try {
      const message = await this.#api.sendMessage(this.#chatId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      return message.message_id;
    } catch (error) {
      // Единственная частая причина — кривая HTML-разметка внутри вывода модели.
      // Пробуем ещё раз обычным текстом, чтобы сообщение не потерялось.
      if (error instanceof GrammyError && error.description.includes("can't parse entities")) {
        const message = await this.#api.sendMessage(this.#chatId, stripTags(html));
        return message.message_id;
      }
      console.error(`[output:${this.#chatId}] send failed:`, error);
      return undefined;
    }
  }

  /**
   * Живой ответ: одно сообщение, в которое дописывается текст по мере того,
   * как модель его выдаёт.
   *
   * Telegram душит частые правки, поэтому редактируем не чаще раза в полторы
   * секунды и только если текст действительно изменился — иначе API отвечает
   * «message is not modified» на каждый второй вызов.
   */
  async stream(text: string, force = false): Promise<void> {
    const trimmed = text.trimEnd();
    if (!trimmed) return;

    const now = Date.now();
    if (!force && now - this.#lastStreamEdit < 1500) return;
    if (trimmed === this.#streamShown) return;

    // В одно сообщение Telegram пускает 4096 символов. Упёрлись — закрываем
    // текущее и продолжаем в новом, иначе правка просто перестанет проходить.
    if (trimmed.length > TELEGRAM_LIMIT) {
      await this.endStream();
      return;
    }

    this.#lastStreamEdit = now;
    this.#streamShown = trimmed;
    const body = esc(trimmed);

    if (this.#streamMessageId === null) {
      this.#streamMessageId = (await this.send(body)) ?? null;
      return;
    }
    try {
      await this.#api.editMessageText(this.#chatId, this.#streamMessageId, body, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      if (!isBenignEditError(error)) console.error(`[output:${this.#chatId}] stream:`, error);
    }
  }

  /** Ответ дописан: следующий пойдёт в новое сообщение. */
  async endStream(): Promise<void> {
    this.#streamMessageId = null;
    this.#streamShown = "";
    this.#lastStreamEdit = 0;
  }

  async status(html: string): Promise<void> {
    const text = `<i>работаю…</i>\n\n${html}`;
    if (this.#statusMessageId === null) {
      const id = await this.send(text);
      this.#statusMessageId = id ?? null;
      return;
    }
    try {
      await this.#api.editMessageText(this.#chatId, this.#statusMessageId, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      if (!isBenignEditError(error)) console.error(`[output:${this.#chatId}] status failed:`, error);
      if (error instanceof GrammyError && error.description.includes("not found")) {
        this.#statusMessageId = null;
      }
    }
  }

  async clearStatus(finalHtml?: string): Promise<void> {
    const id = this.#statusMessageId;
    this.#statusMessageId = null;
    if (id === null) {
      if (finalHtml) await this.send(finalHtml);
      return;
    }
    try {
      if (finalHtml) {
        await this.#api.editMessageText(this.#chatId, id, finalHtml, { parse_mode: "HTML" });
      } else {
        await this.#api.deleteMessage(this.#chatId, id);
      }
    } catch (error) {
      if (!isBenignEditError(error)) {
        // Сообщение могло быть удалено пользователем — не повод падать.
        console.error(`[output:${this.#chatId}] clearStatus failed:`, error);
      }
    }
  }

  async typing(): Promise<void> {
    try {
      await this.#api.sendChatAction(this.#chatId, "typing");
    } catch {
      // Индикатор набора — украшение, ошибку глотаем.
    }
  }

  get permissionHooks(): PermissionBridgeHooks {
    return {
      onAsk: async (pending: PendingPermission) => {
        const heading = pending.title
          ? esc(pending.title)
          : `Claude хочет использовать <b>${esc(pending.toolName)}</b>`;
        const body = describeToolDetailed(pending.toolName, pending.input);
        const note = pending.description ? `\n\n<i>${esc(pending.description)}</i>` : "";
        const text = `${toolIcon(pending.toolName)} ${heading}${note}\n\n${body}`;
        try {
          const message = await this.#api.sendMessage(this.#chatId, text, {
            parse_mode: "HTML",
            reply_markup: permissionKeyboard(pending),
            link_preview_options: { is_disabled: true },
          });
          return message.message_id;
        } catch (error) {
          // Разметка вывода могла сломать HTML — карточку показать обязаны,
          // иначе агент повиснет на этом разрешении.
          console.error(`[output:${this.#chatId}] permission card failed:`, error);
          const message = await this.#api.sendMessage(
            this.#chatId,
            stripTags(`${heading}\n\n${pending.toolName}`),
            { reply_markup: permissionKeyboard(pending) },
          );
          return message.message_id;
        }
      },

      onQuestion: async (pending: PendingQuestion) => {
        return this.#renderQuestion(pending);
      },

      onTimeout: async (pending: PendingPermission) => {
        if (pending.messageId !== undefined) {
          try {
            await this.#api.editMessageReplyMarkup(this.#chatId, pending.messageId, {
              reply_markup: undefined,
            });
          } catch {
            /* карточка могла быть уже отредактирована */
          }
        }
        await this.send(
          `⌛️ Запрос на <b>${esc(pending.toolName)}</b> протух — я отклонил его за тебя. Напиши, что делать дальше.`,
        );
      },
    };
  }

  async renderQuestion(pending: PendingQuestion): Promise<number | undefined> {
    return this.#renderQuestion(pending);
  }

  async #renderQuestion(pending: PendingQuestion): Promise<number | undefined> {
    const current = pending.questions[pending.index];
    if (!current) return undefined;
    const step =
      pending.questions.length > 1 ? ` (${pending.index + 1}/${pending.questions.length})` : "";
    const options = current.options
      .map((o, i) => `${i + 1}. <b>${esc(o.label)}</b> — ${esc(o.description)}`)
      .join("\n");
    const text = `❓ <b>${esc(current.header)}</b>${step}\n${esc(current.question)}\n\n${options}`;
    const message = await this.#api.sendMessage(this.#chatId, text, {
      parse_mode: "HTML",
      reply_markup: questionKeyboard(pending),
    });
    return message.message_id;
  }

  async disableKeyboard(messageId: number, newText?: string): Promise<void> {
    try {
      if (newText !== undefined) {
        await this.#api.editMessageText(this.#chatId, messageId, newText, { parse_mode: "HTML" });
      } else {
        await this.#api.editMessageReplyMarkup(this.#chatId, messageId, {
          reply_markup: undefined,
        });
      }
    } catch (error) {
      if (!isBenignEditError(error)) console.error(`[output:${this.#chatId}] disableKeyboard:`, error);
    }
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
