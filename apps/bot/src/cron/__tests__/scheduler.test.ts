import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronScheduler } from "../scheduler.js";

function createMockLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn().mockReturnThis(),
		level: "info" as const,
	} as any;
}

function createMockRunner() {
	return {
		run: vi.fn().mockResolvedValue({
			agentRunId: "run-1",
			threadId: "thread-1",
			responseText: "Done",
			inputTokens: 100,
			outputTokens: 50,
			costCents: 0.5,
			durationMs: 1000,
		}),
		updateToolConfig: vi.fn(),
	} as any;
}

function createMockPrisma(dueJobs: any[] = []) {
	return {
		cronJob: {
			findMany: vi.fn().mockResolvedValue(dueJobs),
			update: vi.fn().mockResolvedValue({}),
		},
		agentRun: {
			findMany: vi.fn().mockResolvedValue([]),
		},
		learning: {
			findMany: vi.fn().mockResolvedValue([]),
		},
	} as any;
}

const defaultConfig = {
	checkIntervalMs: 30_000,
	heartbeatEnabled: true,
	slackToken: "xoxb-test",
	defaultModel: "claude-sonnet-4-20250514",
};

describe("CronScheduler", () => {
	let scheduler: CronScheduler;

	afterEach(() => {
		scheduler?.stop();
	});

	it("starts and stops without error", () => {
		const prisma = createMockPrisma();
		scheduler = new CronScheduler(prisma, createMockRunner(), createMockLogger(), defaultConfig);
		scheduler.start();
		scheduler.stop();
	});

	it("queries for due jobs on tick", async () => {
		const prisma = createMockPrisma();
		scheduler = new CronScheduler(prisma, createMockRunner(), createMockLogger(), defaultConfig);

		await scheduler.tick();

		expect(prisma.cronJob.findMany).toHaveBeenCalledWith({
			where: {
				enabled: true,
				nextRunAt: { lte: expect.any(Date) },
			},
			include: { workspace: true },
		});
	});

	it("executes due cron job via runner", async () => {
		const runner = createMockRunner();
		const now = new Date();
		const dueJob = {
			id: "cron-1",
			workspaceId: "ws-1",
			name: "Test Job",
			schedule: "* * * * *",
			type: "CUSTOM",
			costTier: 1,
			agentPrompt: "Do something",
			conditionScript: null,
			slackChannel: "C123",
			lastRunAt: null,
			runCount: 0,
			workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
		};

		const prisma = createMockPrisma([dueJob]);
		// Mock workspace budget check
		prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };

		scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
		await scheduler.tick();

		// Wait for async job execution
		await new Promise((r) => setTimeout(r, 100));

		expect(runner.run).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: "ws-1",
				triggerType: "CRON",
				cronJobId: "cron-1",
				userMessage: "Do something",
			}),
		);
	});

	it("skips heartbeat when disabled", async () => {
		const runner = createMockRunner();
		const dueJob = {
			id: "cron-hb",
			workspaceId: "ws-1",
			name: "Heartbeat",
			schedule: "1 8,11,14,17 * * 1-5",
			type: "HEARTBEAT",
			costTier: 2,
			agentPrompt: "heartbeat prompt",
			conditionScript: null,
			slackChannel: null,
			lastRunAt: null,
			runCount: 0,
			workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
		};

		const prisma = createMockPrisma([dueJob]);
		scheduler = new CronScheduler(prisma, runner, createMockLogger(), {
			...defaultConfig,
			heartbeatEnabled: false,
		});

		await scheduler.tick();
		await new Promise((r) => setTimeout(r, 100));

		expect(runner.run).not.toHaveBeenCalled();
	});

	it("evaluates condition script before running", async () => {
		const runner = createMockRunner();
		const dueJob = {
			id: "cron-cond",
			workspaceId: "ws-1",
			name: "Conditional Job",
			schedule: "* * * * *",
			type: "CUSTOM",
			costTier: 1,
			agentPrompt: "Do something",
			conditionScript: "return false;",
			slackChannel: "C123",
			lastRunAt: null,
			runCount: 0,
			workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
		};

		const prisma = createMockPrisma([dueJob]);
		prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };

		scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
		await scheduler.tick();

		await new Promise((r) => setTimeout(r, 100));

		expect(runner.run).not.toHaveBeenCalled();
		expect(prisma.cronJob.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "cron-cond" },
				data: expect.objectContaining({ nextRunAt: expect.any(Date) }),
			}),
		);
	});

	it("updates job status after successful run", async () => {
		const runner = createMockRunner();
		const dueJob = {
			id: "cron-ok",
			workspaceId: "ws-1",
			name: "Good Job",
			schedule: "0 9 * * *",
			type: "CUSTOM",
			costTier: 1,
			agentPrompt: "Do it",
			conditionScript: null,
			slackChannel: "C123",
			lastRunAt: null,
			runCount: 5,
			workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
		};

		const prisma = createMockPrisma([dueJob]);
		prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };

		scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
		await scheduler.tick();
		await new Promise((r) => setTimeout(r, 100));

		expect(prisma.cronJob.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "cron-ok" },
				data: expect.objectContaining({
					lastRunAt: expect.any(Date),
					nextRunAt: expect.any(Date),
					runCount: 6,
					lastRunStatus: "COMPLETED",
				}),
			}),
		);
	});

	it("marks job as FAILED on runner error", async () => {
		const runner = createMockRunner();
		runner.run.mockRejectedValue(new Error("LLM timeout"));

		const dueJob = {
			id: "cron-fail",
			workspaceId: "ws-1",
			name: "Failing Job",
			schedule: "0 9 * * *",
			type: "CUSTOM",
			costTier: 1,
			agentPrompt: "Do it",
			conditionScript: null,
			slackChannel: "C123",
			lastRunAt: null,
			runCount: 0,
			workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
		};

		const prisma = createMockPrisma([dueJob]);
		prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };

		scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
		await scheduler.tick();
		await new Promise((r) => setTimeout(r, 100));

		expect(prisma.cronJob.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "cron-fail" },
				data: expect.objectContaining({
					lastRunStatus: "FAILED",
					runCount: 1,
				}),
			}),
		);
	});
});
