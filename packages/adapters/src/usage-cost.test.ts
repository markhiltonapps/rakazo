import { describe, expect, it } from "vitest";
import { catalogModels } from "./model-vision.js";
import { summarizeBotUsage, type UsageRow, usageCostUsd } from "./usage-cost.js";

const customPrices = new Map([["openai/gpt-6.1-sol", { input: 2, output: 10, cacheRead: 0.1 }]]);

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    botId: "bot-a",
    provider: "openai-compatible",
    model: "openai/gpt-6.1-sol",
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheReadTokens: 800_000,
    cacheWriteTokens: 0,
    ...overrides,
  };
}

describe("usageCostUsd", () => {
  it("prices fresh input, cache reads, and output separately for a custom model", () => {
    // 200k fresh × $2 + 800k cached × $0.10 + 100k output × $10, per million.
    expect(usageCostUsd(row(), customPrices)).toBeCloseTo(0.4 + 0.08 + 1, 10);
  });

  it("charges cache reads at the input price when no cached price was entered", () => {
    const prices = new Map([["openai/gpt-6.1-sol", { input: 2, output: 10 }]]);
    expect(usageCostUsd(row({ outputTokens: 0 }), prices)).toBeCloseTo(2, 10);
  });

  it("uses the catalog's own rates for catalog models", () => {
    const model = catalogModels()
      .getModels("openrouter")
      .find((entry) => !entry.cost.tiers && entry.cost.input > 0 && entry.cost.cacheRead > 0);
    if (!model) throw new Error("expected a priced OpenRouter catalog model");
    const cost = usageCostUsd(row({ provider: "openrouter", model: model.id }), new Map());
    expect(cost).toBeCloseTo(
      (200_000 * model.cost.input + 800_000 * model.cost.cacheRead + 100_000 * model.cost.output) /
        1_000_000,
      10,
    );
  });

  it("has no price for unknown models or a custom model without entered prices", () => {
    expect(usageCostUsd(row({ provider: "openrouter", model: "nope/missing" }), new Map())).toBe(
      undefined,
    );
    expect(usageCostUsd(row(), new Map())).toBe(undefined);
  });
});

describe("summarizeBotUsage", () => {
  it("totals tokens and spend per bot and counts tokens it could not price", () => {
    const usage = summarizeBotUsage(
      [
        row(),
        row({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 }),
        row({ botId: "bot-b", model: "unpriced-model" }),
        row({ botId: null }),
      ],
      customPrices,
    );
    expect(usage).toEqual([
      {
        botId: "bot-a",
        tokens: 1_100_015,
        costUsd: expect.closeTo(1.48 + (10 * 2 + 5 * 10) / 1_000_000, 10),
        unpricedTokens: 0,
      },
      { botId: "bot-b", tokens: 1_100_000, costUsd: 0, unpricedTokens: 1_100_000 },
    ]);
  });
});
