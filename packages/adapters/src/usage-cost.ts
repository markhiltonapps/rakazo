import type { Api, Model } from "@earendil-works/pi-ai";
import { calculateCost } from "@earendil-works/pi-ai";
import type { BotUsage, ModelPrices, UsageOverview, UsageTotals } from "@rakazo/contracts";
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

/** How the user's connections bill for usage. */
export type UsageBilling = {
  /** Prices entered for a custom connection, keyed by model id. */
  customPrices: ReadonlyMap<string, ModelPrices>;
  /** Providers connected through a subscription sign-in, which bill a flat fee, not per token. */
  subscriptionProviders: ReadonlySet<string>;
};

type CustomModelPrices = UsageBilling["customPrices"];

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

function emptyTotals(): UsageTotals {
  return { tokens: 0, costUsd: 0, unpricedTokens: 0, planTokens: 0 };
}

/**
 * Add one call to a running total. Usage on a subscription sign-in counts toward tokens only:
 * the plan's flat fee is not per-token spend.
 */
function addUsage(total: UsageTotals, row: UsageRow, billing: UsageBilling): void {
  const tokens = row.inputTokens + row.outputTokens;
  total.tokens += tokens;
  if (billing.subscriptionProviders.has(row.provider)) {
    total.planTokens += tokens;
    return;
  }
  const cost = usageCostUsd(row, billing.customPrices);
  if (cost === undefined) total.unpricedTokens += tokens;
  else total.costUsd += cost;
}

/** Total tokens and per-token spend per bot. Rows without a bot are left out. */
export function summarizeBotUsage(rows: Iterable<UsageRow>, billing: UsageBilling): BotUsage[] {
  const byBot = new Map<string, BotUsage>();
  for (const row of rows) {
    if (!row.botId) continue;
    const total = byBot.get(row.botId) ?? { botId: row.botId, ...emptyTotals() };
    addUsage(total, row, billing);
    byBot.set(row.botId, total);
  }
  return [...byBot.values()];
}

/** Spend across all usage for today, this week and this month, plus each bot's week. */
export function summarizeUsageOverview(
  rows: Iterable<UsageRow & { createdAt: Date }>,
  billing: UsageBilling,
  periods: { dayStart: Date; weekStart: Date; monthStart: Date },
): UsageOverview {
  const day = emptyTotals();
  const week = emptyTotals();
  const month = emptyTotals();
  const weekRows: UsageRow[] = [];
  for (const row of rows) {
    if (row.createdAt >= periods.dayStart) addUsage(day, row, billing);
    if (row.createdAt >= periods.weekStart) {
      addUsage(week, row, billing);
      weekRows.push(row);
    }
    if (row.createdAt >= periods.monthStart) addUsage(month, row, billing);
  }
  return { day, week, month, byBot: summarizeBotUsage(weekRows, billing) };
}
