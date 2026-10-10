import { usageSince } from "./db.js";
export interface SubscriptionUsage {
  tokens: number;
  tokensWithoutCache: number;
  replies: number;
  filesScanned: number;
}
/** Observed bot usage for this user only. Not a ChatGPT plan quota. */
export function subscriptionUsage(windowMs: number, userId?: number): SubscriptionUsage {
  const tokens = userId === undefined ? 0 : usageSince(userId, windowMs).tokens;
  return { tokens, tokensWithoutCache: tokens, replies: 0, filesScanned: 0 };
}
