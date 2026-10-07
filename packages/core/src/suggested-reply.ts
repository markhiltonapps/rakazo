import type { MessageBlock } from "@rakazo/contracts";
import { isToolActivityBlock } from "./tool-activity.js";

type SuggestingMessage = { role: string; blocks: readonly MessageBlock[] };

/**
 * The reply a bot suggested to the question that ends its message, while that message is still
 * the latest in the thread. Anything posted after it, by the person or a bot, retires it.
 */
export function pendingSuggestedReply(messages: readonly SuggestingMessage[]): string | undefined {
  const latest = messages.at(-1);
  if (latest?.role !== "bot") return undefined;
  const block = latest.blocks.findLast((candidate) => !isToolActivityBlock(candidate));
  return (block?.kind === "text" && block.suggestedReply?.trim()) || undefined;
}
