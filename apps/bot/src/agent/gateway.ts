import type {
	ContentBlock,
	EnvConfig,
	LLMMessage,
	LLMProvider,
	LLMResponse,
	LLMToolDefinition,
} from "@openviktor/shared";
import { createProvider, resolveProvider } from "./providers/index.js";

export interface ChatOptions {
	tools?: LLMToolDefinition[];
	toolChoice?: "auto" | "any" | { type: "tool"; name: string };
	maxTokens?: number;
}

export class LLMGateway {
	private provider: LLMProvider;
	private model: string;
	private defaultMaxTokens: number;
	private timeoutMs: number;

	constructor(config: EnvConfig) {
		this.model = config.DEFAULT_MODEL;
		this.defaultMaxTokens = config.MAX_TOKENS;
		this.timeoutMs = config.AGENT_TIMEOUT_MS;

		const providerName = resolveProvider(this.model);
		this.provider = createProvider(providerName, config);
	}

	async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
		return this.provider.chat({
			model: this.model,
			messages,
			maxTokens: options?.maxTokens ?? this.defaultMaxTokens,
			tools: options?.tools,
			toolChoice: options?.toolChoice,
			timeoutMs: this.timeoutMs,
		});
	}

	getModel(): string {
		return this.model;
	}
}

export function extractText(content: ContentBlock[]): string {
	return content
		.filter((b) => b.type === "text")
		.map((b) => (b as { text: string }).text)
		.join("");
}
