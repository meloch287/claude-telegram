import { randomBytes } from "node:crypto";
import { InlineKeyboard, InputFile, type Api, type Context } from "grammy";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config.js";
import { verifyInitData } from "../crypto.js";
import { isGptUserAllowed, getChat } from "../db.js";
import { engineFor, libraryCall, type Engine } from "../engine.js";
import { taskState, continuationPrompt } from "./task-state.js";
import { esc, hideSecrets } from "../agent/render.js";
import { transcriptionConfigured, transcribe } from "./voice.js";
import { fetchTelegramFile } from "./tgFile.js";
import { speechConfigured } from "./speak.js";

type Draft = { id: string; uid: number; engine: Engine; dialog: string; text: string; edit: boolean; expires: number };
type Action = { uid: number; action: string; body: any; expires: number };
export function createToolsMenu(options: {
  api: Api;
  backend?: typeof libraryCall;
  transcriber?: typeof transcribe;
  downloader?: typeof fetchTelegramFile;
  transcriptionAvailable?: typeof transcriptionConfigured;
  activeClaude(uid: number): string;
  openClaude(uid: number, dialog: string): Promise<void>;
  submitClaude(ctx: Context, text: string, images?: string[]): Promise<boolean>;
}) {
  const library = options.backend ?? libraryCall;
  const recognize = options.transcriber ?? transcribe;
  const downloadVoice = options.downloader ?? fetchTelegramFile;
  const canTranscribe = options.transcriptionAvailable ?? transcriptionConfigured;
  const drafts = new Map<number, Draft>(), actions = new Map<string, Action>(), working = new Set<number>(), voiceRequests = new Map<number, AbortController>();
  const voiceTasks = new Map<number, Promise<void>>();
  const clean = (s: string) => hideSecrets(s, "code");
  function token(uid: number, action: string, body: any) {
    for (const [id, a] of actions) if (a.expires < Date.now()) actions.delete(id);
    if (actions.size > 3000) actions.delete(actions.keys().next().value!);
    const id = randomBytes(9).toString("base64url"); actions.set(id, { uid, action, body, expires: Date.now() + 3600000 }); return "lib:" + id;
  }
  async function active(uid: number, engine: Engine) {
    return engine === "claude" ? options.activeClaude(uid) : (await library(uid, "active")).dialog;
  }
  async function open(uid: number, key: string) {
    const { chats } = await library(uid, "chats");
    const own = chats.find((c: any) => c.id === key);
    if (!own) throw Error("Диалог недоступен или удалён");
    if (own.engine === "claude") await options.openClaude(uid, key.slice(7));
    else await library(uid, "open", { dialog: key });
    const { setEngine } = await import("../engine.js"); setEngine(uid, own.engine);
    return own;
  }
  async function submit(ctx: Context, mode: Engine, dialog: string, text: string, images: string[] = []) {
    await open(ctx.from!.id, mode + "-" + dialog);
    if (mode === "claude") {
      if (!await options.submitClaude(ctx, text, images)) throw Error("Задача пока не запущена. Попробуй ещё раз.");
    } else await library(ctx.from!.id, "submit", { dialog: "gpt-" + dialog, text, images });
  }
  async function showDraft(ctx: Context, d: Draft) {
    await ctx.reply(`<b>🎙 Проверь текст</b> · ${d.engine === "gpt" ? "GPT" : "Claude"}\n\n${esc(d.text.slice(0, 3200))}${d.text.length > 3200 ? "\n…Полный текст приложен файлом." : ""}`, {
      parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Отправить", `voice:send:${d.id}`).text("Изменить", `voice:edit:${d.id}`).row().text("Отмена", `voice:cancel:${d.id}`),
    });
    if (d.text.length > 3200) await ctx.replyWithDocument(new InputFile(Buffer.from(d.text), "Расшифровка.txt"));
  }
  async function recover(ctx: Context, id: string) {
    const uid = ctx.from!.id, task = taskState.get(uid, id);
    if (!task || !taskState.claim(uid, id)) throw Error("Эта задача уже продолжена или удалена.");
    try {
      await submit(ctx, task.engine, task.dialog, continuationPrompt(task), JSON.parse(task.images));
      taskState.state(id, "done");
    } catch (error) { taskState.state(id, "interrupted"); throw error; }
  }
  async function recoveries(uid: number) {
    const { chats } = await library(uid, "chats"), own = new Map(chats.map((c: any) => [c.id, c]));
    return taskState.list(uid).filter(t => own.has(t.engine + "-" + t.dialog)).map(t => ({ id: t.id, engine: t.engine, title: (own.get(t.engine + "-" + t.dialog) as any).title, prompt: clean(t.prompt).slice(0, 180), steps: t.steps, updated: t.updated }));
  }
  async function gallery(ctx: Context, key?: string, page = 0) {
    const uid = ctx.from!.id, mode = engineFor(uid);
    key ||= mode + "-" + await active(uid, mode);
    const { files, truncated } = await library(uid, "list", { dialog: key });
    const keyboard = new InlineKeyboard();
    for (const f of files.slice(page * 8, page * 8 + 8)) keyboard.text(`📄 ${f.path.slice(-46)}`, token(uid, "file", { dialog: key, path: f.path })).row();
    if (page > 0) keyboard.text("‹", token(uid, "gallery", { dialog: key, page: page - 1 }));
    if ((page + 1) * 8 < files.length) keyboard.text("›", token(uid, "gallery", { dialog: key, page: page + 1 }));
    if (files.length) keyboard.row().text("Скачать всё ZIP", token(uid, "zip", { dialog: key }));
    if (config.miniappUrl) keyboard.row().webApp("Открыть галерею", new URL("library.html?tab=files", config.miniappUrl.endsWith("/") ? config.miniappUrl : config.miniappUrl + "/").href);
    await ctx.reply(`📁 Файлы · ${files.length}${truncated ? "+" : ""}\n${files.length ? "Выбери файл для просмотра и скачивания." : "В этом диалоге пока нет файлов."}`, { reply_markup: keyboard });
  }
  async function sendFile(uid: number, body: any, zip = false) {
    const file = await library(uid, zip ? "zip" : "read", body);
    await options.api.sendDocument(uid, new InputFile(Buffer.from(file.data, "base64"), file.name));
  }
  async function handle(ctx: Context): Promise<boolean> {
    const uid = ctx.from!.id, command = ctx.message?.text?.trim() || "", cb = ctx.callbackQuery?.data || "";
    const voice = ctx.message?.voice || ctx.message?.audio;
    const d = drafts.get(uid);
    if (d && d.expires < Date.now()) drafts.delete(uid);
    const editing = drafts.get(uid)?.edit && command && !command.startsWith("/");
    const ours = /^\/(search|files|continue|voice)(?:@\w+)?(?:\s|$)/i.test(command) || /^(lib:|voice:|recover:)/.test(cb) || voice || editing;
    if (!ours) { if (/^\/(stop|new|delete)(?:@\w+)?(?:\s|$)/i.test(command)) { drafts.delete(uid); voiceRequests.get(uid)?.abort(); } return false; }
    if (working.has(uid)) { await ctx.reply("Предыдущий запрос ещё обрабатывается."); return true; }
    working.add(uid);
    try {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      if (voice) {
        if (voiceRequests.has(uid)) throw Error("Уже расшифровываю запись. Подожди или нажми /stop.");
        if (!canTranscribe()) throw Error("Расшифровка голосовых пока не настроена.");
        if ((voice.file_size || 0) > 20 * 1024 * 1024) throw Error("Запись больше 20 МиБ.");
        const engine = engineFor(uid), dialog = await active(uid, engine);
        const controller = new AbortController(); voiceRequests.set(uid, controller);
        const status = await ctx.reply("🎙 Расшифровываю…");
        const task = (async () => { try {
          const info = await ctx.api.getFile(voice.file_id);
          const response = await downloadVoice(`https://api.telegram.org/file/bot${config.botToken}/${info.file_path!}`, controller.signal);
          if (!response.ok) throw Error("Не удалось загрузить запись");
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 20 * 1024 * 1024) throw Error("Запись больше 20 МиБ");
          const text = await recognize(bytes, ctx.message?.audio?.file_name || "voice.ogg", controller.signal);
          controller.signal.throwIfAborted();
          if (!text.trim()) throw Error("Речь не распознана. Попробуй ещё раз.");
          const next = { id: randomBytes(9).toString("base64url"), uid, engine, dialog, text, edit: false, expires: Date.now() + 1800000 };
          drafts.set(uid, next); await showDraft(ctx, next);
        } catch (e) { if (!controller.signal.aborted) await ctx.reply(e instanceof Error ? e.message : "Не удалось расшифровать запись").catch(() => {}); }
        finally { voiceRequests.delete(uid); await ctx.api.deleteMessage(uid, status.message_id).catch(() => {}); } })();
        voiceTasks.set(uid, task); void task.finally(() => { if (voiceTasks.get(uid) === task) voiceTasks.delete(uid); });
      } else if (editing) {
        const next = drafts.get(uid)!; next.text = command; next.edit = false; await showDraft(ctx, next);
      } else if (cb.startsWith("voice:")) {
        const [, verb, id] = cb.split(":"), draft = drafts.get(uid);
        if (!draft || draft.id !== id) throw Error("Черновик устарел. Отправь новую запись.");
        if (verb === "cancel") { drafts.delete(uid); await ctx.editMessageReplyMarkup({ reply_markup: undefined }); await ctx.reply("Черновик удалён."); }
        else if (verb === "edit") { draft.edit = true; await ctx.reply("Пришли исправленный текст одним сообщением. Затем нажми «Отправить»."); }
        else if (verb === "send") {
          if (draft.edit) throw Error("Сначала пришли исправленный текст.");
          await submit(ctx, draft.engine, draft.dialog, draft.text);
          drafts.delete(uid); await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        }
      } else if (cb.startsWith("recover:")) await recover(ctx, cb.slice(8));
      else if (/^\/continue(?:@\w+)?(?:\s|$)/i.test(command)) {
        const rows = await recoveries(uid), kb = new InlineKeyboard();
        for (const r of rows.slice(0, 10)) kb.text(`${r.engine === "gpt" ? "GPT" : "Claude"} · ${r.title.slice(0, 40)}`, "recover:" + r.id).row();
        await ctx.reply(rows.length ? "↻ Прерванные задачи\n\nВыбери задачу. Бот проверит историю и файлы и продолжит оставшиеся шаги." : "Прерванных задач нет.", { reply_markup: kb });
      } else if (/^\/voice(?:@\w+)?(?:\s|$)/i.test(command)) {
        if (!speechConfigured()) throw Error("Озвучка ответов пока не настроена. Голосовой ввод с подтверждением уже доступен.");
        taskState.setVoice(uid, !taskState.voice(uid));
        await ctx.reply(taskState.voice(uid) ? "🔊 Озвучка включена для GPT и Claude. Озвучивается начало ответа, до 900 символов. Выключить — /voice." : "Озвучка выключена. Ответы будут текстом.");
      } else if (/^\/files(?:@\w+)?(?:\s|$)/i.test(command)) await gallery(ctx);
      else if (/^\/search(?:@\w+)?(?:\s|$)/i.test(command)) {
        const query = command.replace(/^\S+\s*/, "");
        if (query.length < 2) { await ctx.reply("🔎 Поиск по всем твоим чатам GPT и Claude:\n/search слово или фраза"); return true; }
        const result = await library(uid, "search", { query, engine: "all" }), kb = new InlineKeyboard();
        let body = `<b>🔎 Найдено чатов: ${result.total}</b>\n`;
        for (const [i, r] of result.results.slice(0, 6).entries()) {
          body += `\n<b>${i + 1}. ${esc(r.title.slice(0, 80))}</b> · ${r.engine === "gpt" ? "GPT" : "Claude"}\n${esc(r.excerpt.slice(0, 280))}\n`;
          if (r.openable) kb.text(`Открыть ${i + 1}`, token(uid, "open", { dialog: r.id }));
        }
        if (config.miniappUrl) kb.row().webApp("Поиск и файлы", new URL("library.html", config.miniappUrl.endsWith("/") ? config.miniappUrl : config.miniappUrl + "/").href);
        await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
      } else if (cb.startsWith("lib:")) {
        const a = actions.get(cb.slice(4)); if (!a || a.uid !== uid || a.expires < Date.now()) throw Error("Кнопка устарела. Открой /files или /search заново.");
        if (a.action === "gallery") await gallery(ctx, a.body.dialog, a.body.page);
        if (a.action === "open") { const chat = await open(uid, a.body.dialog); await ctx.reply(`Открыт ${chat.engine === "gpt" ? "GPT" : "Claude"} · ${chat.title}\nПиши — продолжим.`); }
        if (a.action === "zip" || a.action === "download") await sendFile(uid, a.body, a.action === "zip");
        if (a.action === "file") {
          const file = await library(uid, "read", a.body), bytes = Buffer.from(file.data, "base64");
          if (["image/jpeg", "image/png", "image/webp"].includes(file.type) && bytes.length < 8 * 1024 * 1024) await ctx.replyWithPhoto(new InputFile(bytes, file.name)).catch(() => {});
          else if (file.type.startsWith("text/") && bytes.length < 512000) await ctx.reply(`<pre>${esc(clean(bytes.toString("utf8").slice(0, 1800)))}</pre>`, { parse_mode: "HTML" });
          await ctx.reply(`${file.name} · ${(bytes.length / 1024).toFixed(1)} КБ`, { reply_markup: new InlineKeyboard().text("Скачать файл", token(uid, "download", a.body)) });
        }
      }
    } catch (error) { await ctx.reply(error instanceof Error ? error.message : "Не удалось выполнить действие"); }
    finally { working.delete(uid); }
    return true;
  }
  async function api(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || "/", "http://localhost"); if (!url.pathname.startsWith("/api/tools/")) return false;
    const reply = (status: number, value: any) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(JSON.stringify(value)); };
    const verified = verifyInitData(String(req.headers["x-telegram-init-data"] || ""), config.botToken);
    let uid = 0; try { uid = JSON.parse(verified?.user || "{}").id; } catch {}
    if (!Number.isSafeInteger(uid) || !isGptUserAllowed(uid)) { reply(401, { error: "Открой миниапку из бота" }); return true; }
    if (req.method !== "POST") { reply(405, { error: "Недопустимый метод" }); return true; }
    try {
      let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw Error("Запрос слишком большой"); }
      const body = JSON.parse(raw || "{}"), action = url.pathname.slice(11);
      if (["chats", "search", "file-search", "list"].includes(action)) reply(200, await library(uid, action, body));
      else if (action === "recoveries") reply(200, { tasks: await recoveries(uid) });
      else if (action === "recover") {
        if (working.has(uid)) throw Error("Предыдущий запрос ещё обрабатывается");
        working.add(uid);
        try {
          const ctx = {from:{id:uid},chat:{id:uid,type:"private"},api:options.api,reply:(text:string,extra?:any)=>options.api.sendMessage(uid,text,extra)} as unknown as Context;
          await recover(ctx, String(body.id)); reply(200, {ok:true});
        } finally { working.delete(uid); }
      }
      else if (action === "open") { const chat = await open(uid, body.dialog); reply(200, { ok: true, title: chat.title }); }
      else if (action === "telegram-file") { await sendFile(uid, body, body.zip === true); reply(200, { ok: true }); }
      else if (["download", "zip", "preview"].includes(action)) {
        const file = await library(uid, action === "zip" ? "zip" : "read", body), bytes = Buffer.from(file.data, "base64");
        if (action === "preview") {
          if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) && bytes.length <= 8 * 1024 * 1024) reply(200, { image: `data:${file.type};base64,${file.data}`, name: file.name });
          else if ((file.type.startsWith("text/") || /\.(json|md|py|js|ts|csv)$/i.test(file.name)) && bytes.length < 1024 * 1024) reply(200, { text: clean(bytes.toString("utf8").slice(0, 20000)), name: file.name });
          else reply(200, { name: file.name, text: "Предпросмотр недоступен. Файл можно скачать или получить в Telegram." });
        } else { res.writeHead(200, { "content-type": "application/octet-stream", "content-length": bytes.length, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(bytes); }
      } else reply(404, { error: "Неизвестное действие" });
    } catch (e) { reply(400, { error: e instanceof Error ? e.message : "Не удалось выполнить запрос" }); }
    return true;
  }
  return { handle, api, pending: (uid: number) => voiceTasks.get(uid) || Promise.resolve() };
}
