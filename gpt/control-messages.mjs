import { GrammyError } from "grammy";
import * as store from "./store.mjs";
export function createControlMessages(api) {
  async function remove(uid, id) {
    try {
      await api.deleteMessage(uid, id);
    } catch {
      /* Telegram cannot delete every old message. */
    }
  }
  async function clear(uid) {
    const old = store.controlMessage(uid);
    store.setControlMessage(uid, null);
    if (old) await remove(uid, old);
  }
  async function show(ctx, text, keyboard, formatting = {}) {
    const uid = ctx.from.id,
      current = ctx.callbackQuery?.message?.message_id,
      old = store.controlMessage(uid);
    if (old && old !== current) await remove(uid, old);
    const options = { ...formatting, reply_markup: keyboard || { inline_keyboard: [] } };
    if (current) {
      try {
        await ctx.editMessageText(text, options);
        store.setControlMessage(uid, current);
        return;
      } catch (error) {
        if (error instanceof GrammyError && error.description.includes("message is not modified")) {
          store.setControlMessage(uid, current);
          return;
        }
        await remove(uid, current);
      }
    }
    const message = await ctx.reply(text, options);
    store.setControlMessage(uid, message.message_id);
  }
  return { show, clear };
}
