import { LLMError } from "@openviktor/shared";
import type { EnvConfig, LLMResponse } from "@openviktor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLMGateway, extractText } from "../gateway.js";

const mockChat = vi.fn();

vi.mock("../providers/index.js", () => ({
	resolveProvider: vi.fn((model: string) => {
		if (model.startsWith("claude-")) return "anthropic";
		if (model.startsWith("gpt-")) return "openai";
		if (model.startsWith("gemini-")) return "google";
		throw new LLMError(`Unknown model: ${model}`);
	}),
	createProvider: vi.fn(() => ({
		chat: mockChat,
	})),
}));

function makeConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
	return {
		SLACK_BOT_TOKEN: "xoxb-test",
		SLACK_APP_TOKEN: "xapp-test",
		SLACK_SIGNING_SECRET: "secret",
		ANTHROPIC_API_KEY: "sk-ant-test",
		DATABASE_URL: "postgresql://localhost/test",
		DEFAULT_MODEL: "claude-sonnet-4-20250514",
		MAX_TOKENS: 4096,
		LOG_LEVEL: "info",
		NODE_ENV: "test",
		MAX_CONCURRENT_RUNS: 16,
		TOOL_TIMEOUT_MS: 600_000,
		AGENT_TIMEOUT_MS: 300_000,
		...overrides,
	} as EnvConfig;
}

function makeResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: "msg_test",
		content: [{ type: "text", text: "Hi" }],
		stopReason: "end_turn",
		model: "claude-sonnet-4-20250514",
		inputTokens: 10,
		outputTokens: 5,
		cacheCreationInputTokens: 0,
		cacheReadInputTokens: 0,
		costCents: 0.008,
		...overrides,
	};
}

describe("LLMGateway", () => {
	beforeEach(() => {
		mockChat.mockReset();
	});

	it("routes chat calls through the resolved provider", async () => {
		mockChat.mockResolvedValue(makeResponse());
		const gateway = new LLMGateway(makeConfig());

		const result = await gateway.chat([{ role: "user", content: "Hello" }]);

		expect(result.content[0]).toEqual({ type: "text", text: "Hi" });
		expect(mockChat).toHaveBeenCalledWith({
			model: "claude-sonnet-4-20250514",
			messages: [{ role: "user", content: "Hello" }],
			maxTokens: 4096,
			tools: undefined,
			toolChoice: undefined,
			timeoutMs: 300_000,
		});
	});

	it("passes tools and toolChoice options", async () => {
		mockChat.mockResolvedValue(makeResponse());
		const gateway = new LLMGateway(makeConfig());

		await gateway.chat([{ role: "user", content: "weather" }], {
			tools: [
				{
					name: "get_weather",
					description: "Get weather",
					input_schema: { type: "object" },
				},
			],
			toolChoice: "auto",
		});

		const call = mockChat.mock.calls[0][0];
		expect(call.tools).toHaveLength(1);
		expect(call.toolChoice).toBe("auto");
	});

	it("allows overriding maxTokens", async () => {
		mockChat.mockResolvedValue(makeResponse());
		const gateway = new LLMGateway(makeConfig());

		await gateway.chat([{ role: "user", content: "Hi" }], {
			maxTokens: 512,
		});

		expect(mockChat.mock.calls[0][0].maxTokens).toBe(512);
	});

	it("uses config defaults for model and timeout", async () => {
		mockChat.mockResolvedValue(makeResponse());
		const gateway = new LLMGateway(
			makeConfig({
				DEFAULT_MODEL: "claude-sonnet-4-20250514",
				MAX_TOKENS: 2048,
				AGENT_TIMEOUT_MS: 60_000,
			}),
		);

		await gateway.chat([{ role: "user", content: "Hi" }]);

		const call = mockChat.mock.calls[0][0];
		expect(call.model).toBe("claude-sonnet-4-20250514");
		expect(call.maxTokens).toBe(2048);
		expect(call.timeoutMs).toBe(60_000);
	});

	it("exposes current model via getModel()", () => {
		const gateway = new LLMGateway(makeConfig({ DEFAULT_MODEL: "claude-opus-4-20250514" }));
		expect(gateway.getModel()).toBe("claude-opus-4-20250514");
	});

	it("throws for unknown model prefixes", () => {
		expect(() => new LLMGateway(makeConfig({ DEFAULT_MODEL: "llama-3" }))).toThrow(LLMError);
	});
});

describe("extractText", () => {
	it("extracts text from content blocks", () => {
		const text = extractText([
			{ type: "text", text: "Hello " },
			{
				type: "tool_use",
				id: "t1",
				name: "test",
				input: {},
			},
			{ type: "text", text: "world" },
		]);
		expect(text).toBe("Hello world");
	});

	it("returns empty string for no text blocks", () => {
		expect(extractText([{ type: "tool_use", id: "t1", name: "test", input: {} }])).toBe("");
	});
});
