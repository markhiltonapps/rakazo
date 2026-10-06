import { describe, expect, it, vi } from "vitest";
import { formatBotUsage } from "./bot-usage";

vi.mock("../../lib/rpc", () => ({ rpc: {} }));
vi.mock("@lingui/react/macro", () => ({ Trans: () => null, useLingui: () => ({}) }));

function usage(costUsd: number, tokens = 2_340_000, unpricedTokens = 0, planTokens = 0) {
  return { botId: "bot-a", costUsd, tokens, unpricedTokens, planTokens };
}

describe("formatBotUsage", () => {
  it("shows dollars and compact token counts", () => {
    expect(formatBotUsage(usage(1.8423), "en")).toEqual({ cost: "$1.84", tokens: "2.3M" });
    expect(formatBotUsage(usage(123.4, 950), "en")).toEqual({ cost: "$123", tokens: "950" });
  });

  it("keeps tiny spend visible instead of rounding it to zero", () => {
    expect(formatBotUsage(usage(0.0004), "en").cost).toBe("<$0.01");
  });

  it("marks a total that is missing some unpriced tokens and hides cost when none were priced", () => {
    expect(formatBotUsage(usage(1.5, 2_000_000, 500_000), "en").cost).toBe("$1.50+");
    expect(formatBotUsage(usage(0, 2_000_000, 2_000_000), "en").cost).toBeNull();
  });

  it("leaves subscription usage out of the dollars without marking the total partial", () => {
    expect(formatBotUsage(usage(1.5, 3_000_000, 0, 1_000_000), "en").cost).toBe("$1.50");
    expect(formatBotUsage(usage(0, 3_000_000, 0, 3_000_000), "en")).toEqual({
      cost: null,
      tokens: "3M",
    });
  });
});
