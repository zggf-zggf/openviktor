import type { LLMProvider, LLMToolDefinition, ToolResult } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";

type IntelligenceLevel = "fast" | "balanced" | "smart";

export const aiStructuredOutputDefinition: LLMToolDefinition = {
	name: "ai_structured_output",
	description:
		"Extract structured data that matches a provided JSON schema using the configured LLM provider.",
	input_schema: {
		type: "object",
		properties: {
			prompt: {
				type: "string",
				description: "Instructions describing what structured data to extract",
			},
			output_schema: {
				type: "object",
				description: "JSON schema describing the expected output",
			},
			input_text: {
				type: "string",
				description: "Optional source text to extract from",
			},
			intelligence_level: {
				type: "string",
				enum: ["fast", "balanced", "smart"],
				description: "Model speed/quality preference",
			},
		},
		required: ["prompt", "output_schema"],
	},
};

export function createAiStructuredOutputExecutor(
	llmProvider: LLMProvider,
	model = "claude-3-5-sonnet-20241022",
): ToolExecutor {
	return async (args, _ctx): Promise<ToolResult> => {
		try {
			if (typeof args.prompt !== "string" || args.prompt.length === 0) {
				return { output: null, durationMs: 0, error: "prompt is required" };
			}
			if (!isObjectRecord(args.output_schema)) {
				return { output: null, durationMs: 0, error: "output_schema must be an object" };
			}

			const intelligenceLevel = parseIntelligenceLevel(args.intelligence_level);
			const selectedModel = intelligenceLevel === "fast" ? "claude-haiku-3-5-20241022" : model;

			const systemPrompt =
				"You are a structured data extraction assistant. Extract data matching the provided JSON schema. Respond ONLY with valid JSON.";
			const userMessage = buildUserMessage(args.prompt, args.output_schema, args.input_text);

			const response = await llmProvider.chat({
				model: selectedModel,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userMessage },
				],
			});

			const extracted = extractJsonFromResponse(response.content);
			return { output: extracted, durationMs: 0 };
		} catch (error) {
			return {
				output: null,
				durationMs: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
}

function parseIntelligenceLevel(value: unknown): IntelligenceLevel {
	if (value === "fast" || value === "balanced" || value === "smart") {
		return value;
	}
	return "balanced";
}

function buildUserMessage(prompt: string, outputSchema: unknown, inputText: unknown): string {
	const parts = [`Prompt:\n${prompt}`, `Output schema:\n${JSON.stringify(outputSchema, null, 2)}`];
	if (typeof inputText === "string" && inputText.length > 0) {
		parts.push(`Input text:\n${inputText}`);
	}
	return parts.join("\n\n");
}

function extractJsonFromResponse(content: unknown): { result: unknown; error: string | null } {
	const text = getTextFromResponse(content);
	if (!text) {
		return { result: null, error: "Model returned empty response" };
	}
	try {
		return { result: JSON.parse(text), error: null };
	} catch (err) {
		return {
			result: null,
			error: err instanceof Error ? err.message : "Failed to parse JSON response",
		};
	}
}
function getTextFromResponse(content: unknown): string {
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter(
			(block): block is { type: string; text?: string } =>
				typeof block === "object" && block !== null,
		)
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("\n")
		.trim();
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
