import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../registry.js";
import type { ThreadOrchestrationDeps } from "../tools/thread-orchestration.js";
import {
	createCreateThreadExecutor,
	createGetPathInfoExecutor,
	createListRunningPathsExecutor,
	createSendMessageToThreadExecutor,
	createWaitForPathsExecutor,
} from "../tools/thread-orchestration.js";

const WORKSPACE_ID = "ws_test";

function makeCtx(): ToolExecutionContext {
	return { workspaceId: WORKSPACE_ID, workspaceDir: "/tmp/test", timeoutMs: 30_000 };
}

function makeDeps(overrides: Partial<ThreadOrchestrationDeps> = {}): ThreadOrchestrationDeps {
	return {
		prisma: {
			thread: {
				findFirst: vi.fn().mockResolvedValue(null),
				findUnique: vi.fn().mockResolvedValue(null),
				findMany: vi.fn().mockResolvedValue([]),
				create: vi.fn().mockResolvedValue({ id: "thread_1" }),
				updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			},
			agentRun: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			message: {
				create: vi.fn().mockResolvedValue({}),
			},
			cronJob: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
		} as unknown as ThreadOrchestrationDeps["prisma"],
		slackToken: "xoxb-fake-token",
		spawnAgentRun: vi.fn(),
		...overrides,
	};
}

// Mock global fetch for Slack API calls
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch as unknown as typeof fetch;

function mockSlackSuccess(ts = "1710000000.000100", channel = "C12345") {
	mockFetch.mockResolvedValueOnce({
		ok: true,
		json: async () => ({ ok: true, ts, channel }),
	});
}

function mockSlackError(error = "channel_not_found") {
	mockFetch.mockResolvedValueOnce({
		ok: true,
		json: async () => ({ ok: false, error }),
	});
}

describe("create_thread", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates thread, posts Slack message, and calls spawn", async () => {
		const deps = makeDeps();
		const executor = createCreateThreadExecutor(deps);
		mockSlackSuccess();

		const result = await executor(
			{
				path: "/heartbeat/threads/research",
				title: "Research task",
				initial_prompt: "Research crypto teams",
				channel: "C12345",
			},
			makeCtx(),
		);

		expect(result.error).toBeUndefined();
		const output = result.output as Record<string, unknown>;
		expect(output.status).toBe("created");
		expect(output.thread_id).toBe("thread_1");
		expect(output.path).toBe("/heartbeat/threads/research");

		expect(deps.prisma.thread.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					workspaceId: WORKSPACE_ID,
					path: "/heartbeat/threads/research",
					title: "Research task",
					status: "ACTIVE",
				}),
			}),
		);

		expect(deps.spawnAgentRun).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: WORKSPACE_ID,
				threadId: "thread_1",
				initialPrompt: "Research crypto teams",
			}),
		);
	});

	it("returns error when path already exists", async () => {
		const deps = makeDeps();
		(deps.prisma.thread.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			id: "existing",
		});
		const executor = createCreateThreadExecutor(deps);

		const result = await executor(
			{
				path: "/heartbeat/threads/research",
				title: "Research task",
				initial_prompt: "Do research",
				channel: "C12345",
			},
			makeCtx(),
		);

		expect(result.error).toContain("already exists");
		expect(deps.spawnAgentRun).not.toHaveBeenCalled();
	});

	it("returns error when Slack API fails", async () => {
		const deps = makeDeps();
		const executor = createCreateThreadExecutor(deps);
		mockSlackError();

		const result = await executor(
			{
				path: "/test/thread",
				title: "Test",
				initial_prompt: "Test prompt",
				channel: "C12345",
			},
			makeCtx(),
		);

		expect(result.error).toContain("channel_not_found");
		expect(deps.spawnAgentRun).not.toHaveBeenCalled();
	});

	it("passes dependent_paths to spawn callback", async () => {
		const deps = makeDeps();
		const executor = createCreateThreadExecutor(deps);
		mockSlackSuccess();

		await executor(
			{
				path: "/heartbeat/threads/step2",
				title: "Step 2",
				initial_prompt: "Continue after step 1",
				channel: "C12345",
				dependent_paths: ["/heartbeat/threads/step1"],
			},
			makeCtx(),
		);

		expect(deps.spawnAgentRun).toHaveBeenCalledWith(
			expect.objectContaining({
				dependentPaths: ["/heartbeat/threads/step1"],
			}),
		);
	});

	it("returns error for missing required parameters", async () => {
		const deps = makeDeps();
		const executor = createCreateThreadExecutor(deps);

		const result = await executor({ path: "/test" }, makeCtx());
		expect(result.error).toContain("Missing required parameters");
	});
});

describe("send_message_to_thread", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sends message to thread and triggers reply by default", async () => {
		const deps = makeDeps();
		(deps.prisma.thread.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			id: "thread_1",
			workspaceId: WORKSPACE_ID,
			slackChannel: "C12345",
			slackThreadTs: "1710000000.000100",
		});
		const executor = createSendMessageToThreadExecutor(deps);
		mockSlackSuccess("1710000001.000200");

		const result = await executor(
			{ content: "Research complete.", thread_id: "thread_1" },
			makeCtx(),
		);

		expect(result.error).toBeUndefined();
		const output = result.output as Record<string, unknown>;
		expect(output.status).toBe("sent");

		expect(deps.spawnAgentRun).toHaveBeenCalledWith(
			expect.objectContaining({
				threadId: "thread_1",
				initialPrompt: "Research complete.",
			}),
		);
	});

	it("does not trigger reply when trigger_reply is false", async () => {
		const deps = makeDeps();
		(deps.prisma.thread.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			id: "thread_1",
			workspaceId: WORKSPACE_ID,
			slackChannel: "C12345",
			slackThreadTs: "1710000000.000100",
		});
		const executor = createSendMessageToThreadExecutor(deps);
		mockSlackSuccess();

		await executor(
			{ content: "FYI update", thread_id: "thread_1", trigger_reply: false },
			makeCtx(),
		);

		expect(deps.spawnAgentRun).not.toHaveBeenCalled();
	});

	it("returns error when thread not found", async () => {
		const deps = makeDeps();
		const executor = createSendMessageToThreadExecutor(deps);

		const result = await executor({ content: "Hello", thread_id: "nonexistent" }, makeCtx());

		expect(result.error).toContain("Thread not found");
	});
});

describe("wait_for_paths", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns immediately when all paths are already completed", async () => {
		const deps = makeDeps();
		(deps.prisma.thread.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ path: "/thread/a", status: "COMPLETED" },
			{ path: "/thread/b", status: "COMPLETED" },
		]);
		const executor = createWaitForPathsExecutor(deps);

		const result = await executor(
			{ paths: ["/thread/a", "/thread/b"], timeout_minutes: 1 },
			makeCtx(),
		);

		expect(result.error).toBeUndefined();
		const output = result.output as Record<string, unknown>;
		expect(output.timed_out).toBe(false);
		expect(output.paths_waited_for).toEqual(["/thread/a", "/thread/b"]);
	});

	it("returns error for empty paths array", async () => {
		const deps = makeDeps();
		const executor = createWaitForPathsExecutor(deps);

		const result = await executor({ paths: [] }, makeCtx());
		expect(result.error).toContain("non-empty array");
	});

	it("times out when paths do not complete", async () => {
		const deps = makeDeps();
		(deps.prisma.thread.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ path: "/thread/a", status: "ACTIVE" },
		]);
		const executor = createWaitForPathsExecutor(deps);

		const result = await executor({ paths: ["/thread/a"], timeout_minutes: 0 }, makeCtx());

		const output = result.output as Record<string, unknown>;
		expect(output.timed_out).toBe(true);
		expect(output.paths_waited_for).toEqual(["/thread/a"]);
	});

	it("treats STALE paths as completed", async () => {
		const deps = makeDeps();
		(deps.prisma.thread.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ path: "/thread/a", status: "STALE" },
		]);
		const executor = createWaitForPathsExecutor(deps);

		const result = await executor({ paths: ["/thread/a"], timeout_minutes: 0.001 }, makeCtx());

		const output = result.output as Record<string, unknown>;
		expect(output.timed_out).toBe(false);
	});
});

describe("list_running_paths", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns active thread paths", async () => {
		const deps = makeDeps();
		(deps.prisma.thread.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ path: "/heartbeat/threads/research" },
			{ path: "/slack/user/123" },
		]);
		const executor = createListRunningPathsExecutor(deps);

		const result = await executor({}, makeCtx());

		expect(result.error).toBeUndefined();
		const output = result.output as { running_paths: string[] };
		expect(output.running_paths).toEqual(["/heartbeat/threads/research", "/slack/user/123"]);
	});

	it("returns empty array when no active threads", async () => {
		const deps = makeDeps();
		const executor = createListRunningPathsExecutor(deps);

		const result = await executor({}, makeCtx());

		const output = result.output as { running_paths: string[] };
		expect(output.running_paths).toEqual([]);
	});
});

describe("get_path_info", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns thread info when path matches a thread", async () => {
		const deps = makeDeps();
		const now = new Date();
		(deps.prisma.thread.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			id: "thread_1",
			path: "/heartbeat/threads/research",
			title: "Research task",
			status: "ACTIVE",
			phase: 4,
			parentThreadId: null,
			createdAt: now,
			updatedAt: now,
			_count: { agentRuns: 2 },
		});
		const executor = createGetPathInfoExecutor(deps);

		const result = await executor({ path: "/heartbeat/threads/research" }, makeCtx());

		expect(result.error).toBeUndefined();
		const output = result.output as {
			info: { path_type: string; thread: Record<string, unknown> };
		};
		expect(output.info.path_type).toBe("thread");
		expect(output.info.thread.id).toBe("thread_1");
		expect(output.info.thread.title).toBe("Research task");
		expect(output.info.thread.agent_runs_count).toBe(2);
	});

	it("returns cron info when path matches a cron job", async () => {
		const deps = makeDeps();
		const now = new Date();
		(deps.prisma.cronJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			id: "cron_1",
			name: "Heartbeat",
			schedule: "0 8,11,14,17 * * 1-5",
			description: "Periodic check-in",
			type: "HEARTBEAT",
			enabled: true,
			lastRunAt: now,
			runCount: 42,
			createdAt: now,
			updatedAt: now,
		});
		const executor = createGetPathInfoExecutor(deps);

		const result = await executor({ path: "/heartbeat" }, makeCtx());

		expect(result.error).toBeUndefined();
		const output = result.output as { info: { path_type: string; cron: Record<string, unknown> } };
		expect(output.info.path_type).toBe("cron");
		expect(output.info.cron.title).toBe("Heartbeat");
		expect(output.info.cron.run_count).toBe(42);
	});

	it("returns not_found when path matches nothing", async () => {
		const deps = makeDeps();
		const executor = createGetPathInfoExecutor(deps);

		const result = await executor({ path: "/nonexistent" }, makeCtx());

		expect(result.error).toBeUndefined();
		const output = result.output as { info: { path_type: string } };
		expect(output.info.path_type).toBe("not_found");
	});

	it("returns error when path is missing", async () => {
		const deps = makeDeps();
		const executor = createGetPathInfoExecutor(deps);

		const result = await executor({}, makeCtx());
		expect(result.error).toContain("Missing required parameter");
	});
});
