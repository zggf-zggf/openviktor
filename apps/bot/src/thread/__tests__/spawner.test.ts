import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ThreadSpawnerConfig, createThreadSpawner } from "../spawner.js";

function makeLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn(),
		level: "info",
	};
}

function makePrisma() {
	return {
		thread: {
			findMany: vi.fn().mockResolvedValue([]),
		},
	};
}

function makeRunner() {
	return {
		run: vi.fn().mockResolvedValue({
			agentRunId: "run_1",
			threadId: "thread_1",
			responseText: "Done",
			inputTokens: 100,
			outputTokens: 50,
			costCents: 0.01,
			durationMs: 1000,
		}),
	};
}

function flushPromises(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 50));
}

describe("createThreadSpawner", () => {
	let logger: ReturnType<typeof makeLogger>;
	let prisma: ReturnType<typeof makePrisma>;
	let runner: ReturnType<typeof makeRunner>;
	let config: ThreadSpawnerConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = makeLogger();
		prisma = makePrisma();
		runner = makeRunner();
		config = {
			prisma: prisma as never,
			logger: logger as never,
			getRunner: () => runner as never,
			workspaceName: "Test Workspace",
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("spawns an agent run with correct parameters", async () => {
		const spawner = createThreadSpawner(config);

		spawner({
			workspaceId: "ws_1",
			threadId: "thread_1",
			slackChannel: "C12345",
			slackThreadTs: "1710000000.000100",
			initialPrompt: "Research crypto teams",
		});

		await flushPromises();

		expect(runner.run).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: "ws_1",
				triggerType: "SPAWN",
				slackChannel: "C12345",
				slackThreadTs: "1710000000.000100",
				userMessage: "Research crypto teams",
				memberId: null,
			}),
		);
	});

	it("sets correct prompt context", async () => {
		const spawner = createThreadSpawner(config);

		spawner({
			workspaceId: "ws_1",
			threadId: "thread_1",
			slackChannel: "C12345",
			slackThreadTs: "1710000000.000100",
			initialPrompt: "Do work",
		});

		await flushPromises();

		const runCall = runner.run.mock.calls[0][0];
		expect(runCall.promptContext).toEqual({
			workspaceName: "Test Workspace",
			channel: "C12345",
			triggerType: "SPAWN",
		});
	});

	it("logs error when agent run fails", async () => {
		runner.run.mockRejectedValueOnce(new Error("LLM timeout"));
		const spawner = createThreadSpawner(config);

		spawner({
			workspaceId: "ws_1",
			threadId: "thread_1",
			slackChannel: "C12345",
			slackThreadTs: "1710000000.000100",
			initialPrompt: "Do work",
		});

		await flushPromises();

		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ threadId: "thread_1" }),
			"Spawned agent run failed",
		);
	});

	it("waits for dependencies before spawning", async () => {
		prisma.thread.findMany.mockResolvedValue([{ path: "/dep/a", status: "COMPLETED" }]);
		const spawner = createThreadSpawner(config);

		spawner({
			workspaceId: "ws_1",
			threadId: "thread_1",
			slackChannel: "C12345",
			slackThreadTs: "1710000000.000100",
			initialPrompt: "Continue after dep",
			dependentPaths: ["/dep/a"],
		});

		await flushPromises();

		expect(prisma.thread.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { workspaceId: "ws_1", path: { in: ["/dep/a"] } },
			}),
		);
		expect(runner.run).toHaveBeenCalled();
	});

	it("proceeds even when dependency wait times out", async () => {
		prisma.thread.findMany.mockResolvedValue([{ path: "/dep/a", status: "ACTIVE" }]);

		const shortConfig = {
			...config,
			prisma: prisma as never,
		};
		const spawner = createThreadSpawner(shortConfig);

		// Mock Date.now to simulate timeout
		const realDateNow = Date.now;
		let callCount = 0;
		vi.spyOn(Date, "now").mockImplementation(() => {
			callCount++;
			// First call: start time. Subsequent: past timeout
			if (callCount <= 1) return realDateNow();
			return realDateNow() + 31 * 60 * 1000;
		});

		spawner({
			workspaceId: "ws_1",
			threadId: "thread_1",
			slackChannel: "C12345",
			slackThreadTs: "1710000000.000100",
			initialPrompt: "Continue anyway",
			dependentPaths: ["/dep/a"],
		});

		await flushPromises();

		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ threadId: "thread_1", paths: ["/dep/a"] }),
			"Spawned thread dependency wait timed out, proceeding anyway",
		);
		expect(runner.run).toHaveBeenCalled();
	});
});
