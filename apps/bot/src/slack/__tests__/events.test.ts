import { ThreadLockedError } from "@openviktor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveWorkspace = vi.fn();
const mockResolveMember = vi.fn();
const mockRegisterWorkspaceToken = vi.fn();

vi.mock("../resolve.js", () => ({
	resolveWorkspace: (...args: unknown[]) => mockResolveWorkspace(...args),
	resolveMember: (...args: unknown[]) => mockResolveMember(...args),
	stripBotMention: (_text: string, _botId: string) => _text.replace(/<@[^>]+>\s*/g, "").trim(),
}));

vi.mock("../../tool-gateway/server.js", () => ({
	registerWorkspaceToken: (...args: unknown[]) => mockRegisterWorkspaceToken(...args),
}));

vi.mock("../../thread/index.js", () => ({
	fetchActiveThreads: vi.fn().mockResolvedValue([]),
}));

function makeSlackClient() {
	return {
		team: { info: vi.fn().mockResolvedValue({ team: { name: "Test" } }) },
		users: { info: vi.fn().mockResolvedValue({ user: { real_name: "Alice" } }) },
		conversations: { join: vi.fn().mockResolvedValue({}) },
		reactions: {
			add: vi.fn().mockResolvedValue({}),
			remove: vi.fn().mockResolvedValue({}),
		},
	};
}

function makePrisma() {
	return {
		thread: {
			findFirst: vi.fn().mockResolvedValue(null),
		},
		skill: {
			findMany: vi.fn().mockResolvedValue([]),
		},
	};
}

function makeRunner() {
	return {
		run: vi.fn().mockResolvedValue({
			agentRunId: "run_1",
			threadId: "thread_1",
			responseText: "Hello!",
			messageSent: false,
			inputTokens: 100,
			outputTokens: 50,
			costCents: 0.01,
			durationMs: 500,
		}),
		injectMessage: vi.fn(),
	};
}

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

describe("events - reactions", () => {
	let slackClient: ReturnType<typeof makeSlackClient>;
	let prisma: ReturnType<typeof makePrisma>;
	let runner: ReturnType<typeof makeRunner>;
	let logger: ReturnType<typeof makeLogger>;
	let say: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		slackClient = makeSlackClient();
		prisma = makePrisma();
		runner = makeRunner();
		logger = makeLogger();
		say = vi.fn().mockResolvedValue({});

		mockResolveWorkspace.mockResolvedValue({
			id: "ws_1",
			slackTeamId: "T123",
			slackTeamName: "Test Workspace",
		});
		mockResolveMember.mockResolvedValue({
			id: "mem_1",
			displayName: "Alice",
		});
	});

	async function importAndRegister() {
		const { registerEventHandlers } = await import("../events.js");
		const handlers: Record<string, (...args: unknown[]) => Promise<void>> = {};
		const mockApp = {
			event: (name: string, handler: (...args: unknown[]) => Promise<void>) => {
				handlers[name] = handler;
			},
		};
		registerEventHandlers(mockApp as never, {
			prisma: prisma as never,
			runner: runner as never,
			logger: logger as never,
		});
		return handlers;
	}

	it("adds hourglass reaction at start and swaps to checkmark on completion", async () => {
		const handlers = await importAndRegister();

		await handlers.message({
			event: {
				channel: "C123",
				channel_type: "im",
				user: "U123",
				text: "hello",
				ts: "1234567890.000001",
			},
			say,
			context: { teamId: "T123", botUserId: "B123", botToken: "xoxb-test" },
			client: slackClient,
		});

		// Hourglass reaction added
		expect(slackClient.reactions.add).toHaveBeenCalledWith(
			expect.objectContaining({ name: "hourglass_flowing_sand" }),
		);

		// Hourglass removed and checkmark added on completion
		expect(slackClient.reactions.remove).toHaveBeenCalledWith(
			expect.objectContaining({ name: "hourglass_flowing_sand" }),
		);
		expect(slackClient.reactions.add).toHaveBeenCalledWith(
			expect.objectContaining({ name: "white_check_mark" }),
		);
	});

	it("sends fallback response when agent does not send via tool", async () => {
		runner.run.mockResolvedValue({
			agentRunId: "run_1",
			threadId: "thread_1",
			responseText: "Fallback response",
			messageSent: false,
			inputTokens: 100,
			outputTokens: 50,
			costCents: 0.01,
			durationMs: 500,
		});

		const handlers = await importAndRegister();

		await handlers.message({
			event: {
				channel: "C123",
				channel_type: "im",
				user: "U123",
				text: "hello",
				ts: "1234567890.000001",
			},
			say,
			context: { teamId: "T123", botUserId: "B123", botToken: "xoxb-test" },
			client: slackClient,
		});

		// Fallback response sent via say
		expect(say).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.stringContaining("Fallback response"),
			}),
		);
	});

	it("skips fallback response when agent already sent via tool", async () => {
		runner.run.mockResolvedValue({
			agentRunId: "run_1",
			threadId: "thread_1",
			responseText: "Should not be sent",
			messageSent: true,
			inputTokens: 100,
			outputTokens: 50,
			costCents: 0.01,
			durationMs: 500,
		});

		const handlers = await importAndRegister();

		await handlers.message({
			event: {
				channel: "C123",
				channel_type: "im",
				user: "U123",
				text: "hello",
				ts: "1234567890.000001",
			},
			say,
			context: { teamId: "T123", botUserId: "B123", botToken: "xoxb-test" },
			client: slackClient,
		});

		// say should NOT have been called with the response
		expect(say).not.toHaveBeenCalled();
	});

	it("removes hourglass reaction on error", async () => {
		runner.run.mockRejectedValue(new Error("LLM failed"));

		const handlers = await importAndRegister();

		await handlers.message({
			event: {
				channel: "C123",
				channel_type: "im",
				user: "U123",
				text: "hello",
				ts: "1234567890.000001",
			},
			say,
			context: { teamId: "T123", botUserId: "B123", botToken: "xoxb-test" },
			client: slackClient,
		});

		// Hourglass reaction should be removed even on error
		expect(slackClient.reactions.remove).toHaveBeenCalledWith(
			expect.objectContaining({ name: "hourglass_flowing_sand" }),
		);
	});

	it("injects message and adds eyes reaction on ThreadLockedError", async () => {
		runner.run.mockRejectedValue(new ThreadLockedError("thread_1"));

		const handlers = await importAndRegister();

		await handlers.message({
			event: {
				channel: "C123",
				channel_type: "im",
				user: "U123",
				text: "hello",
				ts: "1234567890.000001",
			},
			say,
			context: { teamId: "T123", botUserId: "B123", botToken: "xoxb-test" },
			client: slackClient,
		});

		expect(runner.injectMessage).toHaveBeenCalledWith("C123", "1234567890.000001", "hello");
		expect(slackClient.reactions.add).toHaveBeenCalledWith(
			expect.objectContaining({ name: "eyes" }),
		);
	});
});
