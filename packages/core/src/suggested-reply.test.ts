import { describe, expect, it } from "vitest";
import { pendingSuggestedReply } from "./suggested-reply.js";

const question = {
  role: "bot",
  blocks: [{ kind: "text" as const, text: "Which day?", suggestedReply: " Thursday works. " }],
};

describe("pendingSuggestedReply", () => {
  it("offers the suggestion while the bot's question is the latest message", () => {
    expect(pendingSuggestedReply([{ role: "user", blocks: [] }, question])).toBe("Thursday works.");
  });

  it("retires the suggestion once anything is posted after the question", () => {
    expect(
      pendingSuggestedReply([question, { role: "user", blocks: [{ kind: "text", text: "Fri" }] }]),
    ).toBeUndefined();
    expect(
      pendingSuggestedReply([question, { role: "bot", blocks: [{ kind: "text", text: "Also" }] }]),
    ).toBeUndefined();
  });

  it("ignores messages without a suggestion", () => {
    expect(pendingSuggestedReply([])).toBeUndefined();
    expect(
      pendingSuggestedReply([{ role: "bot", blocks: [{ kind: "text", text: "Done." }] }]),
    ).toBeUndefined();
  });
});
