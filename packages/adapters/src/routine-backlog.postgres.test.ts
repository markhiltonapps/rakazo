import { randomUUID } from "node:crypto";
import type { BackgroundJob } from "@rakazo/adapter-kit";
import { createDb, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cancelSupersededRoutineRuns, createRunExecutor } from "./executor.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

describePostgres("routine firings while a computer is down (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let db: ReturnType<typeof createDb>;
  const users: string[] = [];
  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
  });
  afterAll(async () => {
    if (!db) return;
    await prisma.organization.deleteMany({ where: { id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  async function setup() {
    const id = randomUUID();
    users.push(id);
    await prisma.user.create({
      data: { id, name: "Routine test", email: `${id}@example.test`, emailVerified: true },
    });
    await prisma.organization.create({
      data: { id, name: "Routine test", slug: id, createdAt: new Date() },
    });
    await prisma.space.create({
      data: { id, organizationId: id, name: "Routine test", isDefault: true },
    });
    const bot = await prisma.bot.create({
      data: { spaceId: id, userId: id, name: "Routine test", color: "test-color" },
    });
    const thread = await prisma.thread.create({ data: { spaceId: id, userId: id, botId: bot.id } });
    const routine = await prisma.routine.create({
      data: {
        spaceId: id,
        botId: bot.id,
        userId: id,
        name: "Inbox",
        prompt: "Check the inbox",
        crons: ["*/45 * * * *"],
        active: true,
        nextRunAt: new Date(Date.now() - 1_000),
      },
    });
    async function firing(status = "queued", attempts: string[] = []) {
      const task = await prisma.task.create({
        data: {
          spaceId: id,
          userId: id,
          botId: bot.id,
          threadId: thread.id,
          prompt: routine.prompt,
          status: "queued",
        },
      });
      const run = await prisma.run.create({
        data: {
          spaceId: id,
          userId: id,
          botId: bot.id,
          threadId: thread.id,
          taskId: task.id,
          status,
          trigger: "routine",
          routineId: routine.id,
        },
      });
      for (const [fence, attempt] of attempts.entries()) {
        await prisma.attempt.create({ data: { runId: run.id, fence: fence + 1, status: attempt } });
      }
      return run;
    }
    return { id, bot, thread, routine, firing };
  }

  function executor() {
    const jobs: BackgroundJob[] = [];
    const notify = vi.fn(async () => undefined);
    const runExecutor = createRunExecutor({
      prisma,
      jobs: {
        enqueue: async (job: BackgroundJob) => {
          jobs.push(job);
        },
        cancel: async () => undefined,
        close: async () => undefined,
      },
      events: { append: vi.fn(async () => ({ seq: 1 })), notify },
    } as unknown as Parameters<typeof createRunExecutor>[0]);
    return { runExecutor, jobs, notify };
  }

  it("cancels only the earlier firings that never got past setup", async () => {
    const { id, bot, thread, routine, firing } = await setup();
    const untouched = await firing();
    const failedSetup = await firing("queued", ["setup_failed", "setup_failed"]);
    const didWork = await firing("queued", ["setup_failed", "interrupted"]);
    const holdsLease = await firing();
    const running = await firing("running");
    const computer = await prisma.computer.create({
      data: {
        spaceId: id,
        userId: id,
        scopeKey: `dedicated:${id}`,
        homeKey: `home:${id}`,
        kind: "e2b",
      },
    });
    await prisma.computerExecutionLease.create({
      data: {
        computerId: computer.id,
        botId: bot.id,
        runId: holdsLease.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const superseded = await prisma.$transaction((tx) =>
      cancelSupersededRoutineRuns(tx, routine.id),
    );

    expect(superseded?.count).toBe(2);
    expect([...(superseded?.threadSeqs.keys() ?? [])]).toEqual([thread.id]);
    const runs = await prisma.run.findMany({
      where: { routineId: routine.id },
      select: { id: true, status: true, completedAt: true, task: { select: { status: true } } },
    });
    const statusOf = (runId: string) => runs.find((run) => run.id === runId);
    expect(statusOf(untouched.id)).toMatchObject({
      status: "cancelled",
      task: { status: "cancelled" },
    });
    expect(statusOf(untouched.id)?.completedAt).toBeInstanceOf(Date);
    expect(statusOf(failedSetup.id)?.status).toBe("cancelled");
    expect(statusOf(didWork.id)?.status).toBe("queued");
    expect(statusOf(holdsLease.id)?.status).toBe("queued");
    expect(statusOf(running.id)?.status).toBe("running");
    const cancelledEvents = await prisma.event.findMany({
      where: { threadId: thread.id, type: "run.cancelled" },
      select: { runId: true },
    });
    expect(cancelledEvents.map((event) => event.runId).sort()).toEqual(
      [untouched.id, failedSetup.id].sort(),
    );
  });

  it("replaces a backlog of stuck firings with the current one", async () => {
    const { routine, firing } = await setup();
    for (let index = 0; index < 5; index += 1) await firing("queued", ["setup_failed"]);
    const { runExecutor, jobs, notify } = executor();

    await runExecutor.wakeRoutine(routine.id, routine.nextRunAt!.toISOString());

    const runs = await prisma.run.findMany({
      where: { routineId: routine.id },
      select: { id: true, status: true },
    });
    const queued = runs.filter((run) => run.status === "queued");
    expect(runs.filter((run) => run.status === "cancelled")).toHaveLength(5);
    expect(queued).toHaveLength(1);
    expect(jobs).toContainEqual(
      expect.objectContaining({ name: "run.continue", payload: { runId: queued[0]!.id } }),
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("folds a firing into one that is still working", async () => {
    const { routine, firing } = await setup();
    const working = await firing("running");
    const { runExecutor, jobs } = executor();

    await runExecutor.wakeRoutine(routine.id, routine.nextRunAt!.toISOString());

    const runs = await prisma.run.findMany({
      where: { routineId: routine.id },
      select: { id: true },
    });
    expect(runs.map((run) => run.id)).toEqual([working.id]);
    expect(jobs.map((job) => job.name)).toEqual(["routine.wakeup"]);
    const after = await prisma.routine.findUniqueOrThrow({ where: { id: routine.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
