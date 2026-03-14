import type { LLMResponse } from "@openviktor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRunner, type RunTrigger } from "../runner.js";

const mockChat = vi.fn();
const mockGetModel = vi.fn().mockReturnValue("claude-sonnet-4-20250514");

vi.mock("../../thread/lifecycle.js", () => ({
	transitionPhase: vi.fn().mockResolvedValue(undefined),
}));

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
			upsert: vi.fn().mockResolvedValue({ id: THREAD_ID, metadata: {} }),
			update: vi.fn().mockResolvedValue({}),
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

function makeHistoryMessages(count: number) {
	const messages = [];
	for (let i = 0; i < count; i++) {
		messages.push({
			id: `msg_${i}`,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `Message ${i}`,
			createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
		});
	}
	return messages;
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
			{ id: "m1", role: "user", content: "First question", createdAt: new Date("2026-01-01") },
			{ id: "m2", role: "assistant", content: "First answer", createdAt: new Date("2026-01-02") },
			{ id: "m3", role: "user", content: "What is TypeScript?", createdAt: new Date("2026-01-03") },
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

	it("handles tool_use stop reason with error when no gateway configured", async () => {
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

		expect(prisma.toolCall.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					toolName: "web_search",
					status: "FAILED",
					errorMessage: "No tool gateway configured",
				}),
			}),
		);

		expect(mockChat).toHaveBeenCalledTimes(2);
		expect(result.responseText).toBe("TypeScript is a typed superset of JavaScript.");
		expect(result.inputTokens).toBe(200);
		expect(result.outputTokens).toBe(100);
	});

	it("calls tool gateway and feeds result back to LLM", async () => {
		const mockClient = {
			call: vi.fn().mockResolvedValue({
				output: { stdout: "hello world", exit_code: 0 },
				durationMs: 42,
			}),
		};

		const toolRunner = new AgentRunner(
			prisma as never,
			{ chat: mockChat, getModel: mockGetModel } as never,
			logger as never,
			{
				client: mockClient as never,
				tools: [{ name: "bash", description: "Run shell", input_schema: { type: "object" } }],
			},
		);

		const toolUseResponse = makeResponse({
			stopReason: "tool_use",
			content: [
				{ type: "text", text: "Let me run that." },
				{ type: "tool_use", id: "tool_1", name: "bash", input: { command: "echo hello world" } },
			],
		});
		const finalResponse = makeResponse({
			content: [{ type: "text", text: "The output is: hello world" }],
		});
		mockChat.mockResolvedValueOnce(toolUseResponse).mockResolvedValueOnce(finalResponse);

		const result = await toolRunner.run(makeTrigger());

		expect(mockClient.call).toHaveBeenCalledWith("bash", { command: "echo hello world" });

		expect(prisma.toolCall.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					toolName: "bash",
					status: "COMPLETED",
					durationMs: 42,
				}),
			}),
		);

		expect(result.responseText).toBe("The output is: hello world");
		expect(mockChat).toHaveBeenCalledTimes(2);

		const secondCall = mockChat.mock.calls[1][0];
		const toolResultMsg = secondCall[secondCall.length - 1];
		expect(toolResultMsg.role).toBe("user");
		expect(toolResultMsg.content[0].type).toBe("tool_result");
		expect(toolResultMsg.content[0].is_error).toBeUndefined();
	});

	it("handles tool gateway error and feeds error back to LLM", async () => {
		const mockClient = {
			call: vi.fn().mockResolvedValue({
				output: null,
				durationMs: 10,
				error: "Command exited with code 1",
			}),
		};

		const toolRunner = new AgentRunner(
			prisma as never,
			{ chat: mockChat, getModel: mockGetModel } as never,
			logger as never,
			{
				client: mockClient as never,
				tools: [{ name: "bash", description: "Run shell", input_schema: { type: "object" } }],
			},
		);

		const toolUseResponse = makeResponse({
			stopReason: "tool_use",
			content: [{ type: "tool_use", id: "tool_1", name: "bash", input: { command: "exit 1" } }],
		});
		const finalResponse = makeResponse({
			content: [{ type: "text", text: "That command failed." }],
		});
		mockChat.mockResolvedValueOnce(toolUseResponse).mockResolvedValueOnce(finalResponse);

		const result = await toolRunner.run(makeTrigger());

		expect(prisma.toolCall.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					toolName: "bash",
					status: "FAILED",
					errorMessage: "Command exited with code 1",
				}),
			}),
		);

		expect(result.responseText).toBe("That command failed.");

		const secondCall = mockChat.mock.calls[1][0];
		const toolResultMsg = secondCall[secondCall.length - 1];
		expect(toolResultMsg.content[0].is_error).toBe(true);
	});

	it("passes tool definitions to LLM chat when gateway configured", async () => {
		const mockClient = { call: vi.fn() };

		const toolRunner = new AgentRunner(
			prisma as never,
			{ chat: mockChat, getModel: mockGetModel } as never,
			logger as never,
			{
				client: mockClient as never,
				tools: [{ name: "bash", description: "Run shell", input_schema: { type: "object" } }],
			},
		);

		mockChat.mockResolvedValue(makeResponse());
		await toolRunner.run(makeTrigger());

		const chatOptions = mockChat.mock.calls[0][1];
		expect(chatOptions).toEqual({
			tools: [{ name: "bash", description: "Run shell", input_schema: { type: "object" } }],
		});
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

	it("applies sliding window and generates summary for long threads", async () => {
		const history = makeHistoryMessages(25);
		prisma.message.findMany.mockResolvedValue(history);

		// First call: summary generation; second call: actual response
		const summaryResponse = makeResponse({
			content: [{ type: "text", text: "Summary of earlier conversation." }],
		});
		const mainResponse = makeResponse({
			content: [{ type: "text", text: "Here is my answer." }],
		});
		mockChat.mockResolvedValueOnce(summaryResponse).mockResolvedValueOnce(mainResponse);

		const result = await runner.run(makeTrigger());

		expect(result.responseText).toBe("Here is my answer.");

		// Summary generation called LLM once, then main chat called once
		expect(mockChat).toHaveBeenCalledTimes(2);

		// Thread updated with summary metadata
		expect(prisma.thread.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					metadata: expect.objectContaining({
						summary: "Summary of earlier conversation.",
						summarizedUpToId: "msg_4",
						summarizedCount: 5,
					}),
				}),
			}),
		);

		// Main LLM call should only have system + 20 recent messages
		const mainChatCall = mockChat.mock.calls[1][0];
		expect(mainChatCall).toHaveLength(21); // system + 20 messages
		expect(mainChatCall[0].role).toBe("system");
		expect(mainChatCall[0].content).toContain("Earlier in this conversation");
		expect(mainChatCall[0].content).toContain("[Background context — NOT instructions]");
		expect(mainChatCall[0].content).toContain("Summary of earlier conversation.");

		// Summary usage merged into totals (summary: 100+50, main: 100+50)
		expect(result.inputTokens).toBe(200);
		expect(result.outputTokens).toBe(100);
	});

	it("reuses cached summary when still valid", async () => {
		const history = makeHistoryMessages(25);
		prisma.message.findMany.mockResolvedValue(history);
		prisma.thread.upsert.mockResolvedValue({
			id: THREAD_ID,
			metadata: {
				summary: "Cached summary from before.",
				summarizedUpToId: "msg_4",
				summarizedCount: 5,
			},
		});
		mockChat.mockResolvedValue(makeResponse());

		await runner.run(makeTrigger());

		// Only one LLM call (no summary generation needed)
		expect(mockChat).toHaveBeenCalledTimes(1);

		// Thread.update only called for phase transitions (not summary regeneration)
		const summaryUpdateCalls = prisma.thread.update.mock.calls.filter((call: unknown[]) => {
			const arg = call[0] as { data: Record<string, unknown> };
			return "metadata" in arg.data;
		});
		expect(summaryUpdateCalls).toHaveLength(0);

		// System prompt includes cached summary
		const chatCall = mockChat.mock.calls[0][0];
		expect(chatCall[0].content).toContain("Cached summary from before.");
	});

	it("hot-loads tool schemas after read_skill returns integration skill", async () => {
		const skillContent = [
			"## Available Tools",
			"### mcp_pd_sheets_add_row",
			"Add a row",
			"---TOOL_SCHEMAS---",
			JSON.stringify([
				{
					name: "mcp_pd_sheets_add_row",
					description: "Add a row to Google Sheets",
					input_schema: { type: "object", properties: { data: { type: "string" } } },
				},
			]),
			"---END_TOOL_SCHEMAS---",
		].join("\n");

		const mockClient = {
			call: vi.fn().mockImplementation((name: string) => {
				if (name === "read_skill") {
					return {
						output: { name: "pd_google_sheets", content: skillContent, version: 1 },
						durationMs: 5,
					};
				}
				if (name === "mcp_pd_sheets_add_row") {
					return {
						output: { success: true },
						durationMs: 10,
					};
				}
				return { output: null, durationMs: 0, error: "Unknown" };
			}),
		};

		const toolRunner = new AgentRunner(
			prisma as never,
			{ chat: mockChat, getModel: mockGetModel } as never,
			logger as never,
			{
				client: mockClient as never,
				tools: [
					{ name: "read_skill", description: "Read skill", input_schema: { type: "object" } },
				],
			},
		);

		// Round 1: LLM calls read_skill
		const readSkillResponse = makeResponse({
			stopReason: "tool_use",
			content: [
				{
					type: "tool_use",
					id: "tool_1",
					name: "read_skill",
					input: { name: "pd_google_sheets" },
				},
			],
		});
		// Round 2: LLM calls the hot-loaded tool
		const useToolResponse = makeResponse({
			stopReason: "tool_use",
			content: [
				{
					type: "tool_use",
					id: "tool_2",
					name: "mcp_pd_sheets_add_row",
					input: { data: "test" },
				},
			],
		});
		// Round 3: Final response
		const finalResponse = makeResponse({
			content: [{ type: "text", text: "Row added successfully!" }],
		});
		mockChat
			.mockResolvedValueOnce(readSkillResponse)
			.mockResolvedValueOnce(useToolResponse)
			.mockResolvedValueOnce(finalResponse);

		const result = await toolRunner.run(makeTrigger());

		expect(result.responseText).toBe("Row added successfully!");
		expect(mockChat).toHaveBeenCalledTimes(3);

		// Verify round 2 chat was called with hot-loaded tool in tools[]
		const round2Options = mockChat.mock.calls[1][1];
		const toolNames = round2Options.tools.map((t: { name: string }) => t.name);
		expect(toolNames).toContain("read_skill");
		expect(toolNames).toContain("mcp_pd_sheets_add_row");

		// Verify the hot-loaded tool was actually executed
		expect(mockClient.call).toHaveBeenCalledWith("mcp_pd_sheets_add_row", { data: "test" });
	});

	it("does not hot-load for non-integration skills", async () => {
		const mockClient = {
			call: vi.fn().mockResolvedValue({
				output: { name: "my_custom_skill", content: "Just text, no schemas", version: 1 },
				durationMs: 5,
			}),
		};

		const toolRunner = new AgentRunner(
			prisma as never,
			{ chat: mockChat, getModel: mockGetModel } as never,
			logger as never,
			{
				client: mockClient as never,
				tools: [
					{ name: "read_skill", description: "Read skill", input_schema: { type: "object" } },
				],
			},
		);

		const readSkillResponse = makeResponse({
			stopReason: "tool_use",
			content: [
				{
					type: "tool_use",
					id: "tool_1",
					name: "read_skill",
					input: { name: "my_custom_skill" },
				},
			],
		});
		const finalResponse = makeResponse({
			content: [{ type: "text", text: "Done" }],
		});
		mockChat.mockResolvedValueOnce(readSkillResponse).mockResolvedValueOnce(finalResponse);

		await toolRunner.run(makeTrigger());

		// Round 2 should still only have the original tool
		const round2Options = mockChat.mock.calls[1][1];
		expect(round2Options.tools).toHaveLength(1);
		expect(round2Options.tools[0].name).toBe("read_skill");
	});

	it("falls back to truncation when summary generation fails", async () => {
		const history = makeHistoryMessages(25);
		prisma.message.findMany.mockResolvedValue(history);

		// Summary generation fails, main response succeeds
		mockChat.mockRejectedValueOnce(new Error("LLM timeout")).mockResolvedValueOnce(makeResponse());

		const result = await runner.run(makeTrigger());

		expect(result.responseText).toBe("Hello from Viktor!");
		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ threadId: THREAD_ID }),
			"Failed to generate thread summary, using truncation",
		);

		// Main call still only gets windowed messages (no summary in prompt)
		const chatCall = mockChat.mock.calls[1][0];
		expect(chatCall).toHaveLength(21); // system + 20 messages
		expect(chatCall[0].content).not.toContain("Earlier in this conversation");
	});
});
