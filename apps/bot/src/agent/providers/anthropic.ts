import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlock,
	LLMMessage,
	LLMProvider,
	LLMResponse,
	LLMToolDefinition,
	StopReason,
} from "@openviktor/shared";
import { calculateCostCents } from "../pricing.js";
import { mapProviderError, withRetry } from "../retry.js";

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicTool = Anthropic.Tool;
type AnthropicContent = Anthropic.ContentBlockParam;

function toAnthropicMessages(messages: LLMMessage[]): AnthropicMessage[] {
	return messages
		.filter((m) => m.role !== "system")
		.map((m) => ({
			role: m.role as "user" | "assistant",
			content: typeof m.content === "string" ? m.content : (m.content as AnthropicContent[]),
		}));
}

function extractSystemPrompt(messages: LLMMessage[]): string | undefined {
	const systemMessages = messages.filter((m) => m.role === "system");
	if (systemMessages.length === 0) return undefined;
	return systemMessages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n\n");
}

function toAnthropicTools(tools: LLMToolDefinition[]): AnthropicTool[] {
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: t.input_schema as Anthropic.Tool.InputSchema,
	}));
}

function mapContentBlocks(blocks: Anthropic.ContentBlock[]): ContentBlock[] {
	return blocks.map((block) => {
		if (block.type === "text") {
			return { type: "text" as const, text: block.text };
		}
		if (block.type === "tool_use") {
			return {
				type: "tool_use" as const,
				id: block.id,
				name: block.name,
				input: block.input as Record<string, unknown>,
			};
		}
		return { type: "text" as const, text: "" };
	});
}

export class AnthropicProvider implements LLMProvider {
	private client: Anthropic;

	constructor(apiKey: string) {
		this.client = new Anthropic({ apiKey });
	}

	async chat(params: {
		model: string;
		messages: LLMMessage[];
		maxTokens?: number;
		tools?: LLMToolDefinition[];
		toolChoice?: "auto" | "any" | { type: "tool"; name: string };
		timeoutMs?: number;
	}): Promise<LLMResponse> {
		const system = extractSystemPrompt(params.messages);
		const messages = toAnthropicMessages(params.messages);

		const requestParams: Anthropic.MessageCreateParamsNonStreaming = {
			model: params.model,
			messages,
			max_tokens: params.maxTokens ?? 4096,
		};

		if (system) {
			requestParams.system = system;
		}

		if (params.tools?.length) {
			requestParams.tools = toAnthropicTools(params.tools);
			if (params.toolChoice) {
				requestParams.tool_choice =
					typeof params.toolChoice === "string" ? { type: params.toolChoice } : params.toolChoice;
			}
		}

		try {
			const response = await withRetry(() =>
				this.client.messages.create(requestParams, {
					timeout: params.timeoutMs,
				}),
			);

			const usage = response.usage;
			const cacheCreation =
				"cache_creation_input_tokens" in usage
					? ((usage.cache_creation_input_tokens as number) ?? 0)
					: 0;
			const cacheRead =
				"cache_read_input_tokens" in usage ? ((usage.cache_read_input_tokens as number) ?? 0) : 0;

			const tokenUsage = {
				inputTokens: usage.input_tokens,
				outputTokens: usage.output_tokens,
				cacheCreationInputTokens: cacheCreation,
				cacheReadInputTokens: cacheRead,
			};

			return {
				id: response.id,
				content: mapContentBlocks(response.content),
				stopReason: response.stop_reason as StopReason,
				model: response.model,
				inputTokens: usage.input_tokens,
				outputTokens: usage.output_tokens,
				cacheCreationInputTokens: cacheCreation,
				cacheReadInputTokens: cacheRead,
				costCents: calculateCostCents(response.model, tokenUsage),
			};
		} catch (error) {
			throw mapProviderError(error);
		}
	}
}
