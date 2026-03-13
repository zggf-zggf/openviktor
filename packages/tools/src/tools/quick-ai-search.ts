import type { LLMProvider, LLMToolDefinition, ToolResult } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";

interface SearchResultItem {
	title: string;
	description: string;
	url: string;
}

export const quickAiSearchDefinition: LLMToolDefinition = {
	name: "quick_ai_search",
	description: "Search the web and optionally summarize results with an LLM.",
	input_schema: {
		type: "object",
		properties: {
			search_question: {
				type: "string",
				description: "Question to search on the web",
			},
		},
		required: ["search_question"],
	},
};

export function createQuickAiSearchExecutor(opts: {
	searchApiKey?: string;
	llmProvider?: LLMProvider;
	model?: string;
}): ToolExecutor {
	const model = opts.model ?? "claude-3-5-sonnet-20241022";

	return async (args, _ctx): Promise<ToolResult> => {
		try {
			if (typeof args.search_question !== "string" || args.search_question.length === 0) {
				return { output: null, durationMs: 0, error: "search_question is required" };
			}

			if (!opts.searchApiKey) {
				return {
					output: {
						search_response: `Web search not configured. Set SEARCH_API_KEY to enable live search. Cannot answer: ${args.search_question}`,
					},
					durationMs: 0,
				};
			}
			const results = await braveSearch(args.search_question, opts.searchApiKey);
			if (results.length === 0) {
				return {
					output: { search_response: "No search results found." },
					durationMs: 0,
				};
			}

			if (opts.llmProvider) {
				const summary = await summarizeWithLlm(
					opts.llmProvider,
					model,
					args.search_question,
					results,
				);
				return { output: { search_response: summary }, durationMs: 0 };
			}

			return {
				output: {
					search_response: formatResults(results),
				},
				durationMs: 0,
			};
		} catch (error) {
			return {
				output: null,
				durationMs: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
}

async function braveSearch(question: string, apiKey: string): Promise<SearchResultItem[]> {
	const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(question)}&count=5`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: {
				Accept: "application/json",
				"X-Subscription-Token": apiKey,
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`Brave Search failed with status ${response.status}`);
		}

		const payload = (await response.json()) as {
			web?: { results?: Array<{ title?: string; description?: string; url?: string }> };
		};
		const entries = payload.web?.results ?? [];

		return entries.slice(0, 5).map((item) => ({
			title: item.title ?? "",
			description: item.description ?? "",
			url: item.url ?? "",
		}));
	} finally {
		clearTimeout(timer);
	}
}

async function summarizeWithLlm(
	llmProvider: LLMProvider,
	model: string,
	question: string,
	results: SearchResultItem[],
): Promise<string> {
	const prompt = `Answer this question based on search results: ${question}\n\nResults:\n${formatResults(results)}`;
	const response = await llmProvider.chat({
		model,
		messages: [{ role: "user", content: prompt }],
	});

	const summary = getTextFromResponse(response.content);
	return summary || "Unable to generate summary from search results.";
}

function formatResults(results: SearchResultItem[]): string {
	return results
		.map((item, index) => `${index + 1}. ${item.title}\n${item.description}\n${item.url}`)
		.join("\n\n");
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
