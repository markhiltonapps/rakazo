import { DEFAULT_MODEL_MAX_TOKENS } from "@rakazo/contracts";

/** Hung completions must fail before the typical 5-minute run lease. */
export const MODEL_STREAM_TIMEOUT_MS = 120_000;
/**
 * `timeoutMs` bounds only time-to-headers; the SSE body that follows is
 * unbounded. A Codex stream silent this long is a dead connection — reasoning
 * models emit thinking deltas continuously while generating.
 */
export const MODEL_STREAM_IDLE_TIMEOUT_MS = 180_000;
/** One retry keeps a transient blip from killing the turn without outliving the lease. */
export const MODEL_STREAM_MAX_RETRIES = 1;

export const TOOL_RESULT_TEXT_LIMIT = 12_000;

export function clipToolResultText(text: string, limit: number = TOOL_RESULT_TEXT_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Tried in order until a shortened JSON result fits: cap long text, then long lists. */
const JSON_FIT_ROUNDS = [
  { text: 2_000, items: 50 },
  { text: 500, items: 20 },
  { text: 200, items: 10 },
  { text: 80, items: 5 },
] as const;

/** Pagination values stop working when cut, so they are kept whole. */
const UNCUT_KEY = /token|cursor|next/i;

/**
 * Fit a structured tool result into the budget by trimming long text and long lists, so every
 * field name, date, id and next-page token survives. A blind cut kept only the first item of a
 * mail search, with no sign that anything was missing.
 */
export function fitToolResultJson(value: unknown, limit: number = TOOL_RESULT_TEXT_LIMIT): string {
  const full = JSON.stringify(value);
  if (full === undefined || full.length <= limit) return full ?? "";
  const note = `\n[Shortened from ${full.length} characters: long text and extra list items were cut. Ask for fewer items or fields, or use the next-page token, to see the rest.]`;
  let text = full;
  for (const round of JSON_FIT_ROUNDS) {
    text = JSON.stringify(shrinkJson(value, round));
    if (text.length + note.length <= limit) return text + note;
  }
  // The cut adds one character, so leave room for it.
  return clipToolResultText(text, Math.max(0, limit - note.length - 1)) + note;
}

function shrinkJson(value: unknown, round: (typeof JSON_FIT_ROUNDS)[number], key = ""): unknown {
  if (typeof value === "string") {
    return value.length > round.text && !UNCUT_KEY.test(key)
      ? `${value.slice(0, round.text)}…`
      : value;
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, round.items).map((item) => shrinkJson(item, round, key));
    return value.length > round.items ? [...kept, `… ${value.length - round.items} more`] : kept;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, shrinkJson(item, round, name)]),
    );
  }
  return value;
}

/**
 * Share one remaining character budget across all text parts.
 * Later text is omitted once the aggregate limit is exhausted; non-text parts stay.
 */
export function clipToolResultContent<T>(
  content: T[],
  limit: number = TOOL_RESULT_TEXT_LIMIT,
): T[] {
  let remaining = limit;
  const clipped: T[] = [];
  for (const part of content) {
    if (
      !part ||
      typeof part !== "object" ||
      !("type" in part) ||
      (part as { type?: unknown }).type !== "text" ||
      !("text" in part)
    ) {
      clipped.push(part);
      continue;
    }
    if (remaining <= 0) continue;
    const text = String((part as { text: unknown }).text);
    if (text.length <= remaining) {
      clipped.push(part);
      remaining -= text.length;
      continue;
    }
    clipped.push({ ...part, text: clipToolResultText(text, remaining) });
    remaining = 0;
  }
  return clipped;
}

/**
 * Prompt tokens providers bill, including cache read/write rather than the uncached remainder.
 * The cache halves are reported alongside so downstream views can show what a cache hit saved.
 */
export function billedPromptTokens(usage: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  const cacheReadTokens = nonNegativeCount(usage.cacheRead);
  const cacheWriteTokens = nonNegativeCount(usage.cacheWrite);
  return {
    inputTokens: nonNegativeCount(usage.input) + cacheReadTokens + cacheWriteTokens,
    outputTokens: nonNegativeCount(usage.output),
    cacheReadTokens,
    cacheWriteTokens,
  };
}

/**
 * A reasoning model spends this same budget on its thinking, so the modest default
 * can be consumed before the reply starts. Wide enough for thinking plus an answer,
 * still far below a model card's 128k ceiling.
 */
export const REASONING_MODEL_MAX_TOKENS = 32_768;

/**
 * Completions default to a modest output cap so OpenRouter-style providers do not
 * hold credit for a model card's 128k ceiling. A configured maxTokens is the escape.
 * Reasoning models get the wider default because their thinking is billed against
 * the same ceiling: at 4k a hard question can leave no room for the reply at all.
 */
export function resolveCompletionMaxTokens(
  modelMaxTokens?: number,
  configuredMaxTokens?: number,
  optionsMaxTokens?: number,
  reasoning?: boolean,
): number {
  const userCap =
    typeof configuredMaxTokens === "number" && configuredMaxTokens >= 1
      ? configuredMaxTokens
      : reasoning
        ? REASONING_MODEL_MAX_TOKENS
        : DEFAULT_MODEL_MAX_TOKENS;
  const optionCap =
    typeof optionsMaxTokens === "number" && optionsMaxTokens >= 1
      ? Math.min(optionsMaxTokens, userCap)
      : userCap;
  if (typeof modelMaxTokens === "number" && modelMaxTokens >= 1) {
    return Math.min(modelMaxTokens, optionCap);
  }
  return optionCap;
}

function nonNegativeCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}
