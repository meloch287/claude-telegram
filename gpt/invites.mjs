import { isGptUserAllowed } from "../dist/db.js";
import { redeemInvite } from "./store.mjs";

// Runs before the allowlist gate so new users can accept a private invitation.
export async function redeemInvitation(ctx, next) {
  const uid = ctx.from?.id;
  const invite = ctx.message?.text?.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+invite_(\S+)\s*$/);
  if (uid && invite && ctx.chat?.type === "private") {
    try {
      ctx.inviteGranted = redeemInvite(uid, invite[1], isGptUserAllowed(uid));
    } catch (error) {
      return ctx.reply(error.message);
    }
  }
  return next();
}
