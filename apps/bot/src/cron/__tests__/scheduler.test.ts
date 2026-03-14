import { afterEach, describe, expect, it, vi } from "vitest";
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

function createMockPrisma(dueJobs: unknown[] = []) {
	return {
		cronJob: {
			findMany: vi.fn().mockResolvedValue(dueJobs),
			findFirst: vi.fn().mockResolvedValue(null),
			update: vi.fn().mockResolvedValue({}),
		},
		agentRun: {
			findMany: vi.fn().mockResolvedValue([]),
		},
		learning: {
			findMany: vi.fn().mockResolvedValue([]),
		},
		thread: {
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

	it("executes due cron job via runner with tier-selected model", async () => {
		const runner = createMockRunner();
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
			model: null,
			scriptCommand: null,
			dependentPaths: [],
			lastRunAt: null,
			runCount: 0,
			workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
		};

		const prisma = createMockPrisma([dueJob]);
		prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };

		scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
		await scheduler.tick();

		await vi.waitFor(() => expect(runner.run).toHaveBeenCalled());

		expect(runner.run).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: "ws-1",
				triggerType: "CRON",
				cronJobId: "cron-1",
				model: expect.stringContaining("haiku"),
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
			model: null,
			scriptCommand: null,
			dependentPaths: [],
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
		await new Promise((r) => setTimeout(r, 50));

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
			model: null,
			scriptCommand: null,
			dependentPaths: [],
			lastRunAt: null,
			runCount: 0,
			workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
		};

		const prisma = createMockPrisma([dueJob]);
		prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };

		scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
		await scheduler.tick();

		await vi.waitFor(() => expect(prisma.cronJob.update).toHaveBeenCalled());

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
			model: null,
			scriptCommand: null,
			dependentPaths: [],
			lastRunAt: null,
			runCount: 5,
			workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
		};

		const prisma = createMockPrisma([dueJob]);
		prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };

		scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
		await scheduler.tick();
		await vi.waitFor(() => expect(prisma.cronJob.update).toHaveBeenCalled());

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
			model: null,
			scriptCommand: null,
			dependentPaths: [],
			lastRunAt: null,
			runCount: 0,
			workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
		};

		const prisma = createMockPrisma([dueJob]);
		prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };

		scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
		await scheduler.tick();
		await vi.waitFor(() => expect(prisma.cronJob.update).toHaveBeenCalled());

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

	it("triggerJob executes immediately bypassing conditions", async () => {
		const runner = createMockRunner();
		const job = {
			id: "cron-trig",
			workspaceId: "ws-1",
			name: "Trigger Me",
			schedule: "0 9 * * *",
			type: "CUSTOM",
			costTier: 2,
			agentPrompt: "Base prompt",
			conditionScript: "return false;",
			slackChannel: "C123",
			model: null,
			scriptCommand: null,
			dependentPaths: [],
			lastRunAt: null,
			runCount: 0,
			enabled: false,
			workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
		};

		const prisma = createMockPrisma();
		prisma.cronJob.findFirst = vi.fn().mockResolvedValue(job);
		prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };

		scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
		await scheduler.triggerJob("cron-trig", "Extra context");

		expect(runner.run).toHaveBeenCalledWith(
			expect.objectContaining({
				userMessage: expect.stringContaining("Extra context"),
			}),
		);
	});

	describe("per-cron model selection", () => {
		it("uses job-level model override when set", async () => {
			const runner = createMockRunner();
			const dueJob = {
				id: "cron-model",
				workspaceId: "ws-1",
				name: "Model Override",
				schedule: "0 9 * * *",
				type: "CUSTOM",
				costTier: 1,
				agentPrompt: "Do something",
				conditionScript: null,
				slackChannel: "C123",
				model: "claude-opus-4-20250514",
				scriptCommand: null,
				dependentPaths: [],
				lastRunAt: null,
				runCount: 0,
				workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
			};

			const prisma = createMockPrisma([dueJob]);
			prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };

			scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
			await scheduler.tick();
			await vi.waitFor(() => expect(runner.run).toHaveBeenCalled());

			expect(runner.run).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "claude-opus-4-20250514",
				}),
			);
		});
	});

	describe("script cron execution", () => {
		it("executes script command without LLM invocation", async () => {
			const runner = createMockRunner();
			const dueJob = {
				id: "script-1",
				workspaceId: "ws-1",
				name: "health-check",
				schedule: "*/15 * * * *",
				type: "SCRIPT",
				costTier: 1,
				agentPrompt: "[script_cron] echo ok",
				conditionScript: null,
				slackChannel: null,
				model: null,
				scriptCommand: "echo ok",
				dependentPaths: [],
				lastRunAt: null,
				runCount: 0,
				workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
			};

			const prisma = createMockPrisma([dueJob]);
			scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
			await scheduler.tick();
			await vi.waitFor(() => expect(prisma.cronJob.update).toHaveBeenCalled());

			expect(runner.run).not.toHaveBeenCalled();
			expect(prisma.cronJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: "script-1" },
					data: expect.objectContaining({
						lastRunStatus: "COMPLETED",
						runCount: 1,
					}),
				}),
			);
		});

		it("marks script cron as FAILED on non-zero exit code", async () => {
			const runner = createMockRunner();
			const dueJob = {
				id: "script-2",
				workspaceId: "ws-1",
				name: "failing-check",
				schedule: "*/15 * * * *",
				type: "SCRIPT",
				costTier: 1,
				agentPrompt: "[script_cron] exit 1",
				conditionScript: null,
				slackChannel: null,
				model: null,
				scriptCommand: "exit 1",
				dependentPaths: [],
				lastRunAt: null,
				runCount: 0,
				workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
			};

			const prisma = createMockPrisma([dueJob]);
			scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
			await scheduler.tick();
			await vi.waitFor(() => expect(prisma.cronJob.update).toHaveBeenCalled());

			expect(runner.run).not.toHaveBeenCalled();
			expect(prisma.cronJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: "script-2" },
					data: expect.objectContaining({
						lastRunStatus: "FAILED",
					}),
				}),
			);
		});

		it("triggerJob handles SCRIPT type without agent runner", async () => {
			const runner = createMockRunner();
			const job = {
				id: "script-trig",
				workspaceId: "ws-1",
				name: "manual-script",
				schedule: "0 9 * * *",
				type: "SCRIPT",
				costTier: 1,
				agentPrompt: "[script_cron] echo triggered",
				conditionScript: null,
				slackChannel: null,
				model: null,
				scriptCommand: "echo triggered",
				dependentPaths: [],
				lastRunAt: null,
				runCount: 0,
				enabled: true,
				workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
			};

			const prisma = createMockPrisma();
			prisma.cronJob.findFirst = vi.fn().mockResolvedValue(job);

			scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
			await scheduler.triggerJob("script-trig");

			expect(runner.run).not.toHaveBeenCalled();
			expect(prisma.cronJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: "script-trig" },
					data: expect.objectContaining({
						lastRunStatus: "COMPLETED",
					}),
				}),
			);
		});
	});

	describe("runScript", () => {
		it("captures stdout and exit code", async () => {
			const prisma = createMockPrisma();
			scheduler = new CronScheduler(prisma, createMockRunner(), createMockLogger(), defaultConfig);
			const result = await scheduler.runScript("echo hello");
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("hello");
		});

		it("captures stderr and non-zero exit code", async () => {
			const prisma = createMockPrisma();
			scheduler = new CronScheduler(prisma, createMockRunner(), createMockLogger(), defaultConfig);
			const result = await scheduler.runScript("echo error >&2 && exit 42");
			expect(result.exitCode).toBe(42);
			expect(result.stderr.trim()).toBe("error");
		});
	});

	describe("dependent paths", () => {
		it("skips job when dependency has not run since last run", async () => {
			const runner = createMockRunner();
			const dueJob = {
				id: "dep-1",
				workspaceId: "ws-1",
				name: "analysis",
				schedule: "0 10 * * *",
				type: "CUSTOM",
				costTier: 2,
				agentPrompt: "Analyze data",
				conditionScript: null,
				slackChannel: "C123",
				model: null,
				scriptCommand: null,
				dependentPaths: ["data-fetch"],
				lastRunAt: new Date("2026-03-14T10:00:00Z"),
				runCount: 1,
				workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
			};

			const prisma = createMockPrisma([dueJob]);
			prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };
			prisma.cronJob.findFirst = vi.fn().mockResolvedValue({
				lastRunAt: new Date("2026-03-14T09:00:00Z"),
				lastRunStatus: "COMPLETED",
			});

			scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
			await scheduler.tick();
			await vi.waitFor(() => expect(prisma.cronJob.update).toHaveBeenCalled());

			expect(runner.run).not.toHaveBeenCalled();
		});

		it("executes job when dependency has completed since last run", async () => {
			const runner = createMockRunner();
			const dueJob = {
				id: "dep-2",
				workspaceId: "ws-1",
				name: "analysis",
				schedule: "0 10 * * *",
				type: "CUSTOM",
				costTier: 2,
				agentPrompt: "Analyze data",
				conditionScript: null,
				slackChannel: "C123",
				model: null,
				scriptCommand: null,
				dependentPaths: ["data-fetch"],
				lastRunAt: new Date("2026-03-14T09:00:00Z"),
				runCount: 1,
				workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
			};

			const prisma = createMockPrisma([dueJob]);
			prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };
			prisma.cronJob.findFirst = vi.fn().mockResolvedValue({
				lastRunAt: new Date("2026-03-14T09:30:00Z"),
				lastRunStatus: "COMPLETED",
			});

			scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
			await scheduler.tick();
			await vi.waitFor(() => expect(runner.run).toHaveBeenCalled());

			expect(runner.run).toHaveBeenCalled();
		});

		it("skips job when dependency last run failed", async () => {
			const runner = createMockRunner();
			const dueJob = {
				id: "dep-3",
				workspaceId: "ws-1",
				name: "analysis",
				schedule: "0 10 * * *",
				type: "CUSTOM",
				costTier: 2,
				agentPrompt: "Analyze data",
				conditionScript: null,
				slackChannel: "C123",
				model: null,
				scriptCommand: null,
				dependentPaths: ["data-fetch"],
				lastRunAt: new Date("2026-03-14T09:00:00Z"),
				runCount: 1,
				workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
			};

			const prisma = createMockPrisma([dueJob]);
			prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };
			prisma.cronJob.findFirst = vi.fn().mockResolvedValue({
				lastRunAt: new Date("2026-03-14T09:30:00Z"),
				lastRunStatus: "FAILED",
			});

			scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
			await scheduler.tick();
			await vi.waitFor(() => expect(prisma.cronJob.update).toHaveBeenCalled());

			expect(runner.run).not.toHaveBeenCalled();
		});

		it("skips job when dependency cron job does not exist", async () => {
			const runner = createMockRunner();
			const dueJob = {
				id: "dep-4",
				workspaceId: "ws-1",
				name: "analysis",
				schedule: "0 10 * * *",
				type: "CUSTOM",
				costTier: 2,
				agentPrompt: "Analyze data",
				conditionScript: null,
				slackChannel: "C123",
				model: null,
				scriptCommand: null,
				dependentPaths: ["nonexistent"],
				lastRunAt: new Date("2026-03-14T09:00:00Z"),
				runCount: 1,
				workspace: { id: "ws-1", slackTeamName: "Test", settings: {} },
			};

			const prisma = createMockPrisma([dueJob]);
			prisma.workspace = { findUnique: vi.fn().mockResolvedValue({ settings: {} }) };
			prisma.cronJob.findFirst = vi.fn().mockResolvedValue(null);

			scheduler = new CronScheduler(prisma, runner, createMockLogger(), defaultConfig);
			await scheduler.tick();
			await vi.waitFor(() => expect(prisma.cronJob.update).toHaveBeenCalled());

			expect(runner.run).not.toHaveBeenCalled();
		});
	});
});
