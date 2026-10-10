import { allowUser, claudeQuota, isGptUserAllowed, isUserAllowedInDb } from "../dist/db.js";
import { ADMIN_ID } from "./store.mjs";
import { redeemInvite } from "./store.mjs";

// Runs before the allowlist gate so new users can accept a private invitation.
export async function redeemInvitation(ctx, next) {
  const uid = ctx.from?.id;
  const invite = ctx.message?.text?.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+invite_(\S+)\s*$/);
  if (uid && invite && ctx.chat?.type === "private") {
    try {
      ctx.inviteGranted = redeemInvite(uid, invite[1], isGptUserAllowed(uid));
      // Claude — на подписке владельца; исполнителя создаст служба ai-bot-claude-workers.
      if (ctx.inviteGranted && !isUserAllowedInDb(uid)) allowUser(uid, ADMIN_ID, null);
      if (ctx.inviteGranted) claudeQuota.applyDefault(uid);
    } catch (error) {
      return ctx.reply(error.message);
    }
  }
  return next();
}
