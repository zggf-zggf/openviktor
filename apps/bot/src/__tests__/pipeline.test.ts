import type { LLMResponse } from "@openviktor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../agent/runner.js";

vi.mock("../agent/gateway.js", () => ({
	LLMGateway: vi.fn(),
	extractText: vi.fn((content: Array<{ type: string; text?: string }>) =>
		content
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join(""),
	),
}));

vi.mock("../slack/resolve.js", () => ({
	resolveWorkspace: vi.fn().mockResolvedValue({
		id: "ws_1",
		slackTeamName: "Test Team",
	}),
	resolveMember: vi.fn().mockResolvedValue({
		id: "mem_1",
		displayName: "Alice",
	}),
}));

function makeResponse(text: string): LLMResponse {
	return {
		id: "msg_test",
		content: [{ type: "text", text }],
		stopReason: "end_turn",
		model: "claude-sonnet-4-20250514",
		inputTokens: 100,
		outputTokens: 50,
		cacheCreationInputTokens: 0,
		cacheReadInputTokens: 0,
		costCents: 0.01,
	};
}

function makePrisma() {
	return {
		thread: {
			upsert: vi.fn().mockResolvedValue({ id: "thread_1" }),
		},
		agentRun: {
			create: vi.fn().mockResolvedValue({ id: "run_1", systemPrompt: "system" }),
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

describe("Pipeline: Agent → mrkdwn → Slack reply", () => {
	let prisma: ReturnType<typeof makePrisma>;
	let runner: AgentRunner;
	const mockChat = vi.fn();
	const mockGetModel = vi.fn().mockReturnValue("claude-sonnet-4-20250514");

	beforeEach(() => {
		vi.clearAllMocks();
		prisma = makePrisma();
		runner = new AgentRunner(
			prisma as never,
			{ chat: mockChat, getModel: mockGetModel } as never,
			makeLogger() as never,
		);
	});

	it("agent response with markdown is returned for mrkdwn conversion", async () => {
		const llmMarkdown = [
			"## Summary",
			"",
			"Here's what **TypeScript** is:",
			"",
			"1. A typed superset of *JavaScript*",
			"2. See [the docs](https://typescriptlang.org)",
			"",
			"```typescript",
			"const x: number = 42;",
			"```",
		].join("\n");

		mockChat.mockResolvedValue(makeResponse(llmMarkdown));

		const result = await runner.run({
			workspaceId: "ws_1",
			memberId: "mem_1",
			triggerType: "MENTION",
			slackChannel: "C123",
			slackThreadTs: "123.456",
			userMessage: "What is TypeScript?",
			promptContext: {
				workspaceName: "Test Team",
				channel: "C123",
				triggerType: "MENTION",
				userName: "Alice",
			},
		});

		// Runner returns raw LLM text — conversion happens in event handler
		expect(result.responseText).toBe(llmMarkdown);
		expect(result.agentRunId).toBe("run_1");
		expect(result.threadId).toBe("thread_1");
	});

	it("persists both user message and assistant response to DB", async () => {
		mockChat.mockResolvedValue(makeResponse("Hello **world**!"));

		await runner.run({
			workspaceId: "ws_1",
			memberId: "mem_1",
			triggerType: "DM",
			slackChannel: "D456",
			slackThreadTs: "789.012",
			userMessage: "hi",
			promptContext: {
				workspaceName: "Test Team",
				channel: "D456",
				triggerType: "DM",
				userName: "Alice",
			},
		});

		// User message saved
		expect(prisma.message.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					role: "user",
					content: "hi",
				}),
			}),
		);

		// Assistant message saved
		expect(prisma.message.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					role: "assistant",
					content: "Hello **world**!",
				}),
			}),
		);

		// Run marked completed
		expect(prisma.agentRun.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "COMPLETED",
				}),
			}),
		);
	});

	it("marks run as FAILED and throws on LLM error", async () => {
		mockChat.mockRejectedValue(new Error("Rate limited"));

		await expect(
			runner.run({
				workspaceId: "ws_1",
				memberId: "mem_1",
				triggerType: "MENTION",
				slackChannel: "C123",
				slackThreadTs: "123.456",
				userMessage: "hello",
				promptContext: {
					workspaceName: "Test Team",
					channel: "C123",
					triggerType: "MENTION",
					userName: "Alice",
				},
			}),
		).rejects.toThrow("Rate limited");

		expect(prisma.agentRun.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "FAILED",
					errorMessage: "Rate limited",
				}),
			}),
		);
	});
});
