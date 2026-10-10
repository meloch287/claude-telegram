import { GrammyError } from "grammy";
import { layoutMarkdown, prepareRichMarkdown, esc } from "../dist/agent/render.js";
import {splitText, splitRichMarkdown} from "../dist/agent/rich-chunks.js";
export {splitRichMarkdown};
export async function sendFormatted(api, uid, markdown) {
  const prepared = prepareRichMarkdown(layoutMarkdown(markdown.trim()));
  if (!prepared) return;
  let last;
  for (const piece of splitRichMarkdown(prepared)) {
    try {
      last = await api.raw.sendRichMessage({ chat_id: uid, rich_message: { markdown: piece } });
    } catch (error) {
      // A transport failure may follow a successful send. Do not resend it as plain text.
      if (!(error instanceof GrammyError) || error.error_code !== 400) throw error;
      for (const part of splitText(piece, 3500))
        last = await api.sendMessage(uid, esc(part), {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
    }
  }
  return last;
}
