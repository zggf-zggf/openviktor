import { LLMError } from "@openviktor/shared";
import type { LLMMessage } from "@openviktor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../providers/anthropic.js";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
	return {
		default: class MockAnthropic {
			messages = { create: mockCreate };
		},
	};
});

vi.mock("../retry.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../retry.js")>();
	return {
		...actual,
		withRetry: <T>(fn: () => Promise<T>) => actual.withRetry(fn, { baseDelayMs: 1, maxRetries: 3 }),
	};
});

function makeResponse(overrides: Record<string, unknown> = {}) {
	return {
		id: "msg_test123",
		type: "message",
		role: "assistant",
		model: "claude-sonnet-4-20250514",
		content: [{ type: "text", text: "Hello!" }],
		stop_reason: "end_turn",
		usage: {
			input_tokens: 100,
			output_tokens: 50,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
		},
		...overrides,
	};
}

describe("AnthropicProvider", () => {
	let provider: AnthropicProvider;

	beforeEach(() => {
		provider = new AnthropicProvider("sk-ant-test-key");
		mockCreate.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sends messages and returns response with token counts", async () => {
		mockCreate.mockResolvedValue(makeResponse());

		const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];

		const result = await provider.chat({
			model: "claude-sonnet-4-20250514",
			messages,
		});

		expect(result.id).toBe("msg_test123");
		expect(result.content).toEqual([{ type: "text", text: "Hello!" }]);
		expect(result.stopReason).toBe("end_turn");
		expect(result.model).toBe("claude-sonnet-4-20250514");
		expect(result.inputTokens).toBe(100);
		expect(result.outputTokens).toBe(50);
		expect(result.costCents).toBeGreaterThan(0);

		expect(mockCreate).toHaveBeenCalledOnce();
		const [params] = mockCreate.mock.calls[0];
		expect(params.model).toBe("claude-sonnet-4-20250514");
		expect(params.messages).toEqual([{ role: "user", content: "Hi" }]);
	});

	it("extracts system messages and passes as top-level system param", async () => {
		mockCreate.mockResolvedValue(makeResponse());

		const messages: LLMMessage[] = [
			{ role: "system", content: "You are helpful." },
			{ role: "system", content: "Be concise." },
			{ role: "user", content: "Hi" },
		];

		await provider.chat({ model: "claude-sonnet-4-20250514", messages });

		const [params] = mockCreate.mock.calls[0];
		expect(params.system).toBe("You are helpful.\n\nBe concise.");
		expect(params.messages).toEqual([{ role: "user", content: "Hi" }]);
	});

	it("passes maxTokens to the API", async () => {
		mockCreate.mockResolvedValue(makeResponse());

		await provider.chat({
			model: "claude-sonnet-4-20250514",
			messages: [{ role: "user", content: "Hi" }],
			maxTokens: 1024,
		});

		const [params] = mockCreate.mock.calls[0];
		expect(params.max_tokens).toBe(1024);
	});

	it("defaults maxTokens to 4096", async () => {
		mockCreate.mockResolvedValue(makeResponse());

		await provider.chat({
			model: "claude-sonnet-4-20250514",
			messages: [{ role: "user", content: "Hi" }],
		});

		const [params] = mockCreate.mock.calls[0];
		expect(params.max_tokens).toBe(4096);
	});

	it("passes tools and toolChoice to the API", async () => {
		mockCreate.mockResolvedValue(
			makeResponse({
				content: [
					{
						type: "tool_use",
						id: "toolu_123",
						name: "get_weather",
						input: { city: "London" },
					},
				],
				stop_reason: "tool_use",
			}),
		);

		const result = await provider.chat({
			model: "claude-sonnet-4-20250514",
			messages: [{ role: "user", content: "What's the weather?" }],
			tools: [
				{
					name: "get_weather",
					description: "Get weather",
					input_schema: {
						type: "object",
						properties: { city: { type: "string" } },
					},
				},
			],
			toolChoice: "auto",
		});

		expect(result.content[0]).toEqual({
			type: "tool_use",
			id: "toolu_123",
			name: "get_weather",
			input: { city: "London" },
		});
		expect(result.stopReason).toBe("tool_use");

		const [params] = mockCreate.mock.calls[0];
		expect(params.tools).toHaveLength(1);
		expect(params.tool_choice).toEqual({ type: "auto" });
	});

	it("handles cache token counts", async () => {
		mockCreate.mockResolvedValue(
			makeResponse({
				usage: {
					input_tokens: 200,
					output_tokens: 100,
					cache_creation_input_tokens: 50,
					cache_read_input_tokens: 30,
				},
			}),
		);

		const result = await provider.chat({
			model: "claude-sonnet-4-20250514",
			messages: [{ role: "user", content: "Hi" }],
		});

		expect(result.cacheCreationInputTokens).toBe(50);
		expect(result.cacheReadInputTokens).toBe(30);
		expect(result.costCents).toBeGreaterThan(0);
	});

	it("throws LLMError for authentication errors", async () => {
		const authError = new Error("Invalid API key");
		Object.assign(authError, { status: 401 });
		mockCreate.mockRejectedValue(authError);

		await expect(
			provider.chat({
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
			}),
		).rejects.toThrow(LLMError);

		await expect(
			provider.chat({
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
			}),
		).rejects.toThrow("Invalid Anthropic API key");
	});

	it("throws LLMError for bad request errors without retry", async () => {
		const badRequest = new Error("Invalid model");
		Object.assign(badRequest, { status: 400 });
		mockCreate.mockRejectedValue(badRequest);

		await expect(
			provider.chat({
				model: "claude-invalid",
				messages: [{ role: "user", content: "Hi" }],
			}),
		).rejects.toThrow("Bad request");

		expect(mockCreate).toHaveBeenCalledOnce();
	});

	it("retries on rate limit errors then throws", async () => {
		const rateLimitError = new Error("Rate limited");
		Object.assign(rateLimitError, { status: 429 });
		mockCreate.mockImplementation(async () => {
			throw rateLimitError;
		});

		await expect(
			provider.chat({
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
			}),
		).rejects.toThrow("Rate limit exceeded");
		expect(mockCreate.mock.calls.length).toBe(4); // 1 + 3 retries
	});

	it("passes timeout option to SDK", async () => {
		mockCreate.mockResolvedValue(makeResponse());

		await provider.chat({
			model: "claude-sonnet-4-20250514",
			messages: [{ role: "user", content: "Hi" }],
			timeoutMs: 5000,
		});

		const [, options] = mockCreate.mock.calls[0];
		expect(options.timeout).toBe(5000);
	});

	it("handles content block arrays in messages", async () => {
		mockCreate.mockResolvedValue(makeResponse());

		const messages: LLMMessage[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Hello from content blocks" }],
			},
		];

		await provider.chat({ model: "claude-sonnet-4-20250514", messages });

		const [params] = mockCreate.mock.calls[0];
		expect(params.messages[0].content).toEqual([
			{ type: "text", text: "Hello from content blocks" },
		]);
	});
});
