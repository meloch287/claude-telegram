import type { Api } from "grammy";
import { GrammyError, InlineKeyboard, InputFile } from "grammy";
import type { ConversationOutput } from "../agent/conversation.js";
import { speechConfigured, synthesize } from "./speak.js";
import { findRepos, status } from "./git.js";
import type {
  PendingPermission,
  PendingQuestion,
  PermissionBridgeHooks,
} from "../agent/permissions.js";
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
  #draftId: number | null = null;
  #streamShown = "";
  #lastStreamEdit = 0;
  #typingTimer: NodeJS.Timeout | null = null;
  /**
   * Читать ли следующий ответ вслух. Ставится на одну задачу: пришло голосовое —
   * ответим голосом. Постоянный режим включается /voice.
   */
  voiceReply = false;
  /**
   * Тихий режим для фоновых задач: без строки состояния и без черновиков.
   * Две строки состояния в одном чате перебивают друг друга и читаются как
   * мигание, а живой черновик фоновой задачи путается с ответом основной.
   */
  quiet = false;
  /**
   * Папка проекта. Нужна кнопкам под ответом: по ней видно, есть ли репозиторий
   * и есть ли в нём что коммитить.
   */
  projectDir: string | null = null;
  /** Последнее обычное сообщение — к нему и подвешиваются кнопки. */
  #lastMessageId: number | null = null;

  constructor(api: Api, chatId: number) {
    this.#api = api;
    this.#chatId = chatId;
  }

  /**
   * Ответ голосом. Молча ничего не делаем, если озвучка не настроена или не
   * просили: голос — добавка к тексту, а не замена ему.
   */
  /**
   * Кнопки быстрых действий под последним сообщением.
   *
   * Подвешиваются к уже отправленному ответу, а не отдельным сообщением: лишняя
   * реплика «вот кнопки» засоряла бы переписку. Состав зависит от того, есть ли
   * что коммитить — предлагать дифф там, где ничего не менялось, бессмысленно.
   */
  async finished(): Promise<void> {
    if (this.quiet || this.#lastMessageId === null) return;

    const keyboard = new InlineKeyboard();
    try {
      const repos = this.projectDir ? findRepos(this.projectDir) : [];
      if (repos.length === 1) {
        const state = await status(repos[0]!);
        if (state.entries.length > 0) {
          keyboard.text("📊 Дифф", "act:diff").text("💾 Коммит", "act:commit");
        }
      }
    } catch {
      // Репозиторий мог оказаться битым — тогда просто меньше кнопок.
    }
    // Показывать нечего — и не показываем: пустая клавиатура под ответом
    // выглядит как недоделка.
    if (keyboard.inline_keyboard.flat().length === 0) return;

    try {
      await this.#api.editMessageReplyMarkup(this.#chatId, this.#lastMessageId, {
        reply_markup: keyboard,
      });
    } catch {
      // Сообщение могло быть документом или уже уехать — не беда.
    }
  }

  async speak(text: string): Promise<void> {
    if (!this.voiceReply || !speechConfigured()) return;
    const audio = await synthesize(text);
    if (!audio) return;
    try {
      await this.#api.sendVoice(this.#chatId, new InputFile(audio, "ответ.mp3"));
    } catch (error) {
      // Телеграм может не принять формат — текст уже ушёл, этого достаточно.
      console.error("не отправил голосом:", (error as Error).message);
    }
  }

  async send(html: string): Promise<number | undefined> {
    if (!html.trim()) return undefined;
    try {
      const message = await this.#api.sendMessage(this.#chatId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      this.#lastMessageId = message.message_id;
      return message.message_id;
    } catch (error) {
      // Единственная частая причина — кривая HTML-разметка внутри вывода модели.
      // Пробуем ещё раз обычным текстом, чтобы сообщение не потерялось.
      if (error instanceof GrammyError && error.description.includes("can't parse entities")) {
        const message = await this.#api.sendMessage(this.#chatId, stripTags(html));
        this.#lastMessageId = message.message_id;
        return message.message_id;
      }
      console.error(`[output:${this.#chatId}] send failed:`, error);
      return undefined;
    }
  }

  /**
   * Живой ответ через sendMessageDraft — штатный способ Telegram показывать
   * текст, пока он генерируется. Правки черновика с одним и тем же draft_id
   * клиент анимирует сам, поэтому текст проявляется плавно, а не рывками, как
   * при редактировании обычного сообщения.
   *
   * Черновик эфемерный: живёт тридцать секунд и в историю не попадает. Готовый
   * ответ обязательно досылается отдельным sendMessage — иначе он просто
   * исчезнет.
   */
  async stream(text: string, force = false): Promise<void> {
    if (this.quiet) return;

    const trimmed = text.trimEnd();
    if (!trimmed) return;

    const now = Date.now();
    // Чаще раза в секунду смысла нет: анимацию рисует клиент, а лимиты общие.
    if (!force && now - this.#lastStreamEdit < 1000) return;
    if (trimmed === this.#streamShown) return;

    this.#lastStreamEdit = now;
    this.#streamShown = trimmed;
    await this.#draft(trimmed.slice(-TELEGRAM_LIMIT));
  }

  /** Пустой черновик — встроенная заглушка «Thinking…» у клиента. */
  async startDraft(): Promise<void> {
    if (this.quiet) return;

    this.#streamShown = "";
    this.#lastStreamEdit = 0;
    await this.#draft("");
  }

  async #draft(text: string): Promise<void> {
    // draft_id должен быть ненулевым и одинаковым на весь ответ: по нему
    // клиент и понимает, что это продолжение того же черновика.
    if (this.#draftId === null) this.#draftId = (Date.now() % 2_000_000_000) + 1;
    try {
      await this.#api.raw.sendMessageDraft({
        chat_id: this.#chatId,
        draft_id: this.#draftId,
        text,
      });
    } catch (error) {
      // Старые клиенты и старые версии Bot API черновиков не знают — тогда
      // просто ничего не показываем, вместо того чтобы валить сессию.
      if (error instanceof GrammyError) return;
      console.error(`[output:${this.#chatId}] draft:`, error);
    }
  }

  /** Ответ дописан: следующий пойдёт новым черновиком. */
  async endStream(): Promise<void> {
    this.#draftId = null;
    this.#streamShown = "";
    this.#lastStreamEdit = 0;
  }

  /**
   * Отдать файл. Так возвращаются результаты работы и длинные куски кода: в
   * сообщении они всё равно не помещаются, а файл открывается и сохраняется.
   *
   * Картинки уходят фотографией: график или скриншот, присланный документом,
   * не показывает превью, и чтобы его увидеть, надо скачивать файл.
   */
  async document(path: string, caption?: string, fileName?: string): Promise<void> {
    try {
      if (isImage(path)) {
        await this.#api.sendPhoto(this.#chatId, new InputFile(path, fileName), {
          ...(caption ? { caption, parse_mode: "HTML" as const } : {}),
        });
        return;
      }
      await this.#api.sendDocument(this.#chatId, new InputFile(path, fileName), {
        ...(caption ? { caption, parse_mode: "HTML" as const } : {}),
      });
    } catch (error) {
      console.error(`[output:${this.#chatId}] document failed:`, error);
      await this.send(`⚠️ Не смог отправить <code>${esc(fileName ?? path)}</code>.`);
    }
  }

  /** То же, но для содержимого, которого нет на диске. */
  async documentFromText(text: string, fileName: string, caption?: string): Promise<void> {
    try {
      await this.#api.sendDocument(
        this.#chatId,
        new InputFile(Buffer.from(text, "utf8"), fileName),
        {
          ...(caption ? { caption, parse_mode: "HTML" as const } : {}),
        },
      );
    } catch (error) {
      console.error(`[output:${this.#chatId}] document failed:`, error);
    }
  }

  async status(html: string): Promise<void> {
    if (this.quiet) return;

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
      if (!isBenignEditError(error))
        console.error(`[output:${this.#chatId}] status failed:`, error);
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

  /**
   * «Печатает…» на всё время работы.
   *
   * По документации Telegram статус держится «5 секунд или меньше», а любое
   * сообщение бота его сбрасывает. Поэтому одного вызова мало — нужен пульс
   * чаще этого срока, иначе индикатор гаснет на первой же долгой задаче.
   */
  startTyping(): void {
    if (this.#typingTimer) return;
    void this.typing();
    this.#typingTimer = setInterval(() => void this.typing(), 4000);
    // Висящий таймер не должен удерживать процесс при выключении.
    this.#typingTimer.unref?.();
  }

  stopTyping(): void {
    if (!this.#typingTimer) return;
    clearInterval(this.#typingTimer);
    this.#typingTimer = null;
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
      if (!isBenignEditError(error))
        console.error(`[output:${this.#chatId}] disableKeyboard:`, error);
    }
  }
}

/**
 * Картинка ли это.
 *
 * SVG сюда не входит намеренно: Telegram его как фото не принимает, поэтому он
 * должен уйти документом, а не потеряться на ошибке отправки.
 */
export function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
