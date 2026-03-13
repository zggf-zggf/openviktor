import type { LLMResponse } from "@openviktor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRunner, type RunTrigger } from "../runner.js";

const mockChat = vi.fn();
const mockGetModel = vi.fn().mockReturnValue("claude-sonnet-4-20250514");

vi.mock("../gateway.js", () => ({
	LLMGateway: vi.fn().mockImplementation(() => ({
		chat: mockChat,
		getModel: mockGetModel,
	})),
	extractText: vi.fn((content: Array<{ type: string; text?: string }>) =>
		content
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join(""),
	),
}));

function makeResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: "msg_test",
		content: [{ type: "text", text: "Hello from Viktor!" }],
		stopReason: "end_turn",
		model: "claude-sonnet-4-20250514",
		inputTokens: 100,
		outputTokens: 50,
		cacheCreationInputTokens: 0,
		cacheReadInputTokens: 0,
		costCents: 0.01,
		...overrides,
	};
}

const WORKSPACE_ID = "ws_test";
const MEMBER_ID = "mem_test";
const THREAD_ID = "thread_test";
const RUN_ID = "run_test";

function makeTrigger(overrides: Partial<RunTrigger> = {}): RunTrigger {
	return {
		workspaceId: WORKSPACE_ID,
		memberId: MEMBER_ID,
		triggerType: "MENTION",
		slackChannel: "C12345",
		slackThreadTs: "1234567890.123456",
		userMessage: "What is TypeScript?",
		promptContext: {
			workspaceName: "Test Workspace",
			channel: "C12345",
			triggerType: "MENTION",
			userName: "Alice",
		},
		...overrides,
	};
}

function makePrisma() {
	return {
		thread: {
			upsert: vi.fn().mockResolvedValue({ id: THREAD_ID }),
		},
		agentRun: {
			create: vi.fn().mockResolvedValue({ id: RUN_ID, systemPrompt: "system" }),
			update: vi.fn().mockResolvedValue({}),
		},
		message: {
			create: vi.fn().mockResolvedValue({}),
			findMany: vi.fn().mockResolvedValue([]),
		},
		toolCall: {
			create: vi.fn().mockResolvedValue({}),
		},
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

describe("AgentRunner", () => {
	let prisma: ReturnType<typeof makePrisma>;
	let logger: ReturnType<typeof makeLogger>;
	let runner: AgentRunner;

	beforeEach(() => {
		vi.clearAllMocks();
		prisma = makePrisma();
		logger = makeLogger();
		runner = new AgentRunner(
			prisma as never,
			{ chat: mockChat, getModel: mockGetModel } as never,
			logger as never,
		);
	});

	it("creates thread, agent run, persists messages, and returns result", async () => {
		mockChat.mockResolvedValue(makeResponse());

		const result = await runner.run(makeTrigger());

		expect(prisma.thread.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					workspaceId_slackChannel_slackThreadTs: {
						workspaceId: WORKSPACE_ID,
						slackChannel: "C12345",
						slackThreadTs: "1234567890.123456",
					},
				},
			}),
		);

		expect(prisma.agentRun.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					workspaceId: WORKSPACE_ID,
					threadId: THREAD_ID,
					triggeredBy: MEMBER_ID,
					triggerType: "MENTION",
					status: "RUNNING",
				}),
			}),
		);

		// User message persisted
		expect(prisma.message.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					role: "user",
					content: "What is TypeScript?",
				}),
			}),
		);

		// Assistant message persisted
		expect(prisma.message.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					role: "assistant",
					content: "Hello from Viktor!",
				}),
			}),
		);

		// Run marked as completed
		expect(prisma.agentRun.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "COMPLETED",
					inputTokens: 100,
					outputTokens: 50,
					costCents: 0.01,
				}),
			}),
		);

		expect(result.responseText).toBe("Hello from Viktor!");
		expect(result.agentRunId).toBe(RUN_ID);
		expect(result.threadId).toBe(THREAD_ID);
		expect(result.inputTokens).toBe(100);
		expect(result.outputTokens).toBe(50);
	});

	it("loads conversation history from previous thread messages", async () => {
		prisma.message.findMany.mockResolvedValue([
			{ role: "user", content: "First question", createdAt: new Date("2026-01-01") },
			{ role: "assistant", content: "First answer", createdAt: new Date("2026-01-02") },
			{ role: "user", content: "What is TypeScript?", createdAt: new Date("2026-01-03") },
		]);
		mockChat.mockResolvedValue(makeResponse());

		await runner.run(makeTrigger());

		const chatCall = mockChat.mock.calls[0][0];
		expect(chatCall).toHaveLength(4); // system + 3 history messages
		expect(chatCall[0].role).toBe("system");
		expect(chatCall[1]).toEqual({ role: "user", content: "First question" });
		expect(chatCall[2]).toEqual({ role: "assistant", content: "First answer" });
		expect(chatCall[3]).toEqual({ role: "user", content: "What is TypeScript?" });
	});

	it("marks run as FAILED on LLM error", async () => {
		mockChat.mockRejectedValue(new Error("API timeout"));

		await expect(runner.run(makeTrigger())).rejects.toThrow("API timeout");

		expect(prisma.agentRun.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "FAILED",
					errorMessage: "API timeout",
				}),
			}),
		);

		expect(logger.error).toHaveBeenCalled();
	});

	it("handles tool_use stop reason with error response", async () => {
		const toolUseResponse = makeResponse({
			stopReason: "tool_use",
			content: [
				{ type: "text", text: "Let me search that." },
				{ type: "tool_use", id: "tool_1", name: "web_search", input: { query: "TypeScript" } },
			],
		});
		const finalResponse = makeResponse({
			content: [{ type: "text", text: "TypeScript is a typed superset of JavaScript." }],
		});
		mockChat.mockResolvedValueOnce(toolUseResponse).mockResolvedValueOnce(finalResponse);

		const result = await runner.run(makeTrigger());

		// Tool call recorded as failed
		expect(prisma.toolCall.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					toolName: "web_search",
					status: "FAILED",
					errorMessage: "No tool executors registered",
				}),
			}),
		);

		// LLM called twice (initial + after tool error)
		expect(mockChat).toHaveBeenCalledTimes(2);

		// Final response returned
		expect(result.responseText).toBe("TypeScript is a typed superset of JavaScript.");

		// Tokens accumulated from both calls
		expect(result.inputTokens).toBe(200);
		expect(result.outputTokens).toBe(100);
	});

	it("handles DM trigger type", async () => {
		mockChat.mockResolvedValue(makeResponse());

		await runner.run(makeTrigger({ triggerType: "DM" }));

		expect(prisma.agentRun.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ triggerType: "DM" }),
			}),
		);
	});

	it("tracks duration in milliseconds", async () => {
		mockChat.mockResolvedValue(makeResponse());

		const result = await runner.run(makeTrigger());

		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(prisma.agentRun.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					durationMs: expect.any(Number),
				}),
			}),
		);
	});

	it("includes system prompt with workspace context", async () => {
		mockChat.mockResolvedValue(makeResponse());

		await runner.run(makeTrigger());

		// System prompt stored on agent run
		expect(prisma.agentRun.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					systemPrompt: expect.stringContaining("Test Workspace"),
				}),
			}),
		);
	});
});
