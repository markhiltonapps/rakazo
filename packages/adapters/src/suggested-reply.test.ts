import type { AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { cleanSuggestion, suggestReplyForRun } from "./suggested-reply.js";
import { questionAwaitingSuggestion } from "./user-progress.js";

type Row = { id: string; seq: number; role: string; runId: string | null; blocks: MessageBlock[] };

function fixture(options: { draft: string; messages?: Row[]; provider?: string }) {
  const messages: Row[] = options.messages ?? [
    { id: "m1", seq: 1, role: "user", runId: null, blocks: [{ kind: "text", text: "Plan it" }] },
    {
      id: "m2",
      seq: 2,
      role: "bot",
      runId: "run-1",
      blocks: [{ kind: "text", text: "Which day works best?" }],
    },
  ];
  const latest = (where: { role?: string }) =>
    [...messages].reverse().find((row) => !where.role || row.role === where.role) ?? null;
  const events: unknown[] = [];
  const usage: unknown[] = [];
  const db = {
    run: {
      findUnique: async () => ({
        id: "run-1",
        spaceId: "space-1",
        userId: "user-1",
        botId: "bot-1",
        threadId: "thread-1",
      }),
    },
    message: {
      findFirst: async ({ where }: { where: { role?: string } }) => latest(where),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { blocks: MessageBlock[] };
      }) => {
        const row = messages.find((candidate) => candidate.id === where.id)!;
        row.blocks = data.blocks;
        return row;
      },
    },
    thread: { update: async () => ({ nextEventSeq: 8 }) },
    event: {
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
        return { ...(data as object), seq: 7 };
      },
    },
    usageRecord: { create: async ({ data }: { data: unknown }) => usage.push(data) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  const requests: AgentRunRequest[] = [];
  const runtime = {
    async *run(request: AgentRunRequest): AsyncIterable<AgentRuntimeEvent> {
      requests.push(request);
      yield {
        type: "usage",
        inputTokens: 120,
        outputTokens: 12,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        provider: "test",
        model: "small",
      };
      yield { type: "done", text: options.draft };
    },
  } as unknown as AgentRuntime;
  const notify = vi.fn(async () => undefined);
  const deps = {
    prisma: db as unknown as PrismaClient,
    runtime,
    events: { notify },
    resolveModel: async () => ({ provider: options.provider ?? "test", id: "small" }),
  };
  return { deps, messages, events, usage, requests, notify };
}

describe("suggestReplyForRun", () => {
  it("attaches the drafted reply to the question and records its usage", async () => {
    const { deps, messages, events, usage, requests, notify } = fixture({
      draft: '"Thursday afternoon works."',
    });
    await suggestReplyForRun(deps, "run-1");

    expect(requests[0]?.prompt).toContain("Plan it");
    expect(requests[0]?.prompt).toContain("Which day works best?");
    expect(requests[0]?.tools).toEqual([]);
    expect(messages[1]?.blocks).toEqual([
      { kind: "text", text: "Which day works best?", suggestedReply: "Thursday afternoon works." },
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "thread.message.updated",
        payload: expect.objectContaining({ messageId: "m2" }),
      }),
    ]);
    expect(usage).toEqual([
      expect.objectContaining({ runId: "run-1", botId: "bot-1", inputTokens: 120 }),
    ]);
    expect(notify).toHaveBeenCalledWith("thread-1", 7);
  });

  it("leaves the message alone when the model finds no question", async () => {
    const { deps, messages, notify } = fixture({ draft: "NONE" });
    await suggestReplyForRun(deps, "run-1");
    expect(messages[1]?.blocks[0]).not.toHaveProperty("suggestedReply");
    expect(notify).not.toHaveBeenCalled();
  });

  it("skips a reply that is no longer the latest message", async () => {
    const { deps, requests, messages } = fixture({ draft: "Thursday." });
    messages.push({
      id: "m3",
      seq: 3,
      role: "user",
      runId: null,
      blocks: [{ kind: "text", text: "Friday" }],
    });
    await suggestReplyForRun(deps, "run-1");
    expect(requests).toEqual([]);
  });

  it("does not call a model when only the scripted runtime is configured", async () => {
    const { deps, requests } = fixture({ draft: "Thursday.", provider: "scripted" });
    await suggestReplyForRun(deps, "run-1");
    expect(requests).toEqual([]);
  });
});

describe("cleanSuggestion", () => {
  it("strips quotes and rejects NONE, empty, and overlong drafts", () => {
    expect(cleanSuggestion(" “Tuesday at 10.” ")).toBe("Tuesday at 10.");
    expect(cleanSuggestion("NONE")).toBeUndefined();
    expect(cleanSuggestion("none.")).toBeUndefined();
    expect(cleanSuggestion("  ")).toBeUndefined();
    expect(cleanSuggestion("x".repeat(401))).toBeUndefined();
  });
});

describe("questionAwaitingSuggestion", () => {
  it("finds a closing question that has no suggestion yet", () => {
    expect(questionAwaitingSuggestion([{ kind: "text", text: "Which day?" }])).toBe("Which day?");
    expect(
      questionAwaitingSuggestion([{ kind: "text", text: "Which day?", suggestedReply: "Tue" }]),
    ).toBeUndefined();
    expect(questionAwaitingSuggestion([{ kind: "text", text: "Done." }])).toBeUndefined();
    expect(questionAwaitingSuggestion([])).toBeUndefined();
  });
});
