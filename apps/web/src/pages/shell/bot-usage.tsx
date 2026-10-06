import { Trans, useLingui } from "@lingui/react/macro";
import type { BotUsage } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";

const BOT_USAGE_REFRESH_MS = 60_000;

/** Each bot's tokens and spend over the last week, refreshed every minute. */
export function useBotUsage(): ReadonlyMap<string, BotUsage> {
  const [usage, setUsage] = useState<ReadonlyMap<string, BotUsage>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const rows = await rpc.usage.byBot();
        if (!cancelled) setUsage(new Map(rows.map((row) => [row.botId, row])));
      } catch {
        // Keep the last good totals on transient failures.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void tick(), BOT_USAGE_REFRESH_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
  return usage;
}

/**
 * Compact figures for the sidebar. Cost is null when none of the tokens could be priced, and
 * ends in "+" when some could not, so a partial total never reads as complete.
 */
export function formatBotUsage(
  usage: BotUsage,
  locale: string,
): { cost: string | null; tokens: string } {
  const tokens = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(usage.tokens);
  if (usage.unpricedTokens >= usage.tokens) return { cost: null, tokens };
  const dollars = (amount: number, digits: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  const amount =
    usage.costUsd > 0 && usage.costUsd < 0.01
      ? `<${dollars(0.01, 2)}`
      : dollars(usage.costUsd, usage.costUsd >= 100 ? 0 : 2);
  return { cost: usage.unpricedTokens > 0 ? `${amount}+` : amount, tokens };
}

export function BotUsageLine({ usage }: { usage: BotUsage | undefined }) {
  const { i18n, t } = useLingui();
  if (!usage || usage.tokens <= 0) return null;
  const { cost, tokens } = formatBotUsage(usage, i18n.locale);
  return (
    <div
      className="mt-1 truncate text-[11.5px] text-muted-foreground/60 tabular-nums"
      title={t`Last 7 days`}
      data-testid="bot-usage"
    >
      {cost ? (
        <Trans>
          {cost} · {tokens} tokens this week
        </Trans>
      ) : (
        <Trans>{tokens} tokens this week</Trans>
      )}
    </div>
  );
}
