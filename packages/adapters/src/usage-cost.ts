import type { Api, Model } from "@earendil-works/pi-ai";
import { calculateCost } from "@earendil-works/pi-ai";
import type { BotUsage, ModelPrices } from "@rakazo/contracts";
import { catalogModels } from "./model-vision.js";
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  openAiCompatibleModel,
} from "./pi-openai-compatible-provider.js";

/** One recorded model call. `inputTokens` already includes cache reads and writes. */
export type UsageRow = {
  botId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Prices a user entered for their custom connection, keyed by model id. */
export type CustomModelPrices = ReadonlyMap<string, ModelPrices>;

function pricedModel(row: UsageRow, customPrices: CustomModelPrices): Model<Api> | undefined {
  if (row.provider !== OPENAI_COMPATIBLE_PROVIDER_ID) {
    return catalogModels().getModel(row.provider, row.model);
  }
  const prices = customPrices.get(row.model);
  if (!prices) return undefined;
  return {
    ...openAiCompatibleModel(row.model, ""),
    cost: {
      input: prices.input,
      output: prices.output,
      cacheRead: prices.cacheRead ?? prices.input,
      cacheWrite: prices.input,
    },
  };
}

/** Dollar cost of one recorded call, or undefined when its model has no known price. */
export function usageCostUsd(row: UsageRow, customPrices: CustomModelPrices): number | undefined {
  const model = pricedModel(row, customPrices);
  if (!model) return undefined;
  const cacheRead = Math.max(0, row.cacheReadTokens);
  const cacheWrite = Math.max(0, row.cacheWriteTokens);
  return calculateCost(model, {
    input: Math.max(0, row.inputTokens - cacheRead - cacheWrite),
    output: Math.max(0, row.outputTokens),
    cacheRead,
    cacheWrite,
    totalTokens: row.inputTokens + row.outputTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }).total;
}

/** Total tokens and spend per bot. Rows without a bot are left out. */
export function summarizeBotUsage(
  rows: Iterable<UsageRow>,
  customPrices: CustomModelPrices,
): BotUsage[] {
  const byBot = new Map<string, BotUsage>();
  for (const row of rows) {
    if (!row.botId) continue;
    const tokens = row.inputTokens + row.outputTokens;
    const cost = usageCostUsd(row, customPrices);
    const total = byBot.get(row.botId) ?? {
      botId: row.botId,
      tokens: 0,
      costUsd: 0,
      unpricedTokens: 0,
    };
    total.tokens += tokens;
    if (cost === undefined) total.unpricedTokens += tokens;
    else total.costUsd += cost;
    byBot.set(row.botId, total);
  }
  return [...byBot.values()];
}
