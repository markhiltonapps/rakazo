import { Trans, useLingui } from "@lingui/react/macro";
import type { BotUsage, UsageOverview, UsageOverviewInput, UsageTotals } from "@rakazo/contracts";
import { useEffect, useRef, useState } from "react";
import { rpc } from "../../lib/rpc";

const USAGE_REFRESH_MS = 15_000;

/**
 * Where today, this week and this month began in the viewer's time zone. `firstDayOfWeek`
 * follows Intl week info: 1 is Monday and 7 is Sunday.
 */
export function usagePeriodStarts(now: Date, firstDayOfWeek: number): UsageOverviewInput {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysIntoWeek = (now.getDay() - (firstDayOfWeek % 7) + 7) % 7;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysIntoWeek);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    dayStart: dayStart.toISOString(),
    weekStart: weekStart.toISOString(),
    monthStart: monthStart.toISOString(),
  };
}

type LocaleWithWeekInfo = Intl.Locale & {
  getWeekInfo?: () => { firstDay: number };
  weekInfo?: { firstDay: number };
};

function firstDayOfWeek(locale: string): number {
  try {
    const intlLocale = new Intl.Locale(locale) as LocaleWithWeekInfo;
    return (intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo)?.firstDay ?? 1;
  } catch {
    return 1;
  }
}

/**
 * Spend for today, this week and this month, with each bot's week. Refreshes every 15 seconds
 * while the page is visible, and right away whenever `activityKey` changes.
 */
export function useUsageOverview(activityKey: string): UsageOverview | null {
  const [overview, setOverview] = useState<UsageOverview | null>(null);
  const refresh = useRef<() => void>(() => undefined);
  const lastActivityKey = useRef(activityKey);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let again = false;
    let timer: number | undefined;
    const tick = async () => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      window.clearTimeout(timer);
      try {
        const next = await rpc.usage.overview(
          usagePeriodStarts(new Date(), firstDayOfWeek(navigator.language)),
        );
        if (!cancelled) setOverview(next);
      } catch {
        // Keep the last good totals on transient failures.
      } finally {
        inFlight = false;
        if (!cancelled) {
          if (again) {
            again = false;
            void tick();
          } else {
            // While hidden, stop; returning to the page refreshes right away.
            timer = window.setTimeout(() => {
              if (document.visibilityState === "visible") void tick();
            }, USAGE_REFRESH_MS);
          }
        }
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    refresh.current = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (lastActivityKey.current === activityKey) return;
    lastActivityKey.current = activityKey;
    refresh.current();
  }, [activityKey]);

  return overview;
}

function formatTokens(tokens: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
    tokens,
  );
}

/** Per-token spend. Ends in "+" when some tokens could not be priced, so it never reads as complete. */
function formatCost(costUsd: number, unpricedTokens: number, locale: string): string {
  const dollars = (amount: number, digits: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  const amount =
    costUsd > 0 && costUsd < 0.01
      ? `<${dollars(0.01, 2)}`
      : dollars(costUsd, costUsd >= 100 ? 0 : 2);
  return unpricedTokens > 0 ? `${amount}+` : amount;
}

/**
 * Compact figures for the sidebar. Cost is per-token spend only: subscription usage is left
 * out, and cost is null when no tokens were billed per token.
 */
export function formatBotUsage(
  usage: BotUsage,
  locale: string,
): { cost: string | null; tokens: string } {
  const tokens = formatTokens(usage.tokens, locale);
  if (usage.unpricedTokens + usage.planTokens >= usage.tokens) return { cost: null, tokens };
  return { cost: formatCost(usage.costUsd, usage.unpricedTokens, locale), tokens };
}

export function BotUsageLine({ usage }: { usage: BotUsage | undefined }) {
  const { i18n } = useLingui();
  if (!usage || usage.tokens <= 0) return null;
  const { cost, tokens } = formatBotUsage(usage, i18n.locale);
  return (
    <div
      className="mt-1 truncate text-[11.5px] text-muted-foreground/60 tabular-nums"
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

/** True once there is any usage this month to summarize. */
export function hasMonthUsage(overview: UsageOverview | null): overview is UsageOverview {
  return Boolean(overview && overview.month.tokens > 0);
}

/** Dollars spent today, this week and this month across every bot; tokens on hover. */
export function SpendSummary({ overview }: { overview: UsageOverview }) {
  const { i18n, t } = useLingui();
  const periods: Array<{ key: string; label: string; totals: UsageTotals }> = [
    { key: "day", label: t`Today`, totals: overview.day },
    { key: "week", label: t`Week`, totals: overview.week },
    { key: "month", label: t`Month`, totals: overview.month },
  ];
  return (
    <dl className="app-no-drag flex min-w-0 items-start gap-3.5" data-testid="spend-summary">
      {periods.map(({ key, label, totals }) => {
        const tokens = formatTokens(totals.tokens, i18n.locale);
        return (
          <div key={key} className="min-w-0" title={t`${tokens} tokens`}>
            <dt className="text-[10px] font-medium tracking-wider text-muted-foreground/60 uppercase">
              {label}
            </dt>
            <dd
              className="text-[13px] font-medium text-foreground/85 tabular-nums"
              data-testid={`spend-${key}`}
            >
              {formatCost(totals.costUsd, totals.unpricedTokens, i18n.locale)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
