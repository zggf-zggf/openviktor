import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePath, resolveSafePathStrict } from "../workspace.js";

const DEFAULT_CONTEXT7_BASE_URL = "https://context7.com/api";

type DocsLookup = {
	library_id: string;
	name: string;
	description: string;
};

type LibraryDocs = {
	content: string;
	title: string;
	error?: string;
};

function extractLibraryId(entry: Record<string, unknown>): string {
	if (typeof entry.library_id === "string") {
		return entry.library_id;
	}
	if (typeof entry.id === "string") {
		return entry.id;
	}
	if (typeof entry.slug === "string") {
		return entry.slug;
	}
	return "";
}

function getFirstSearchResult(payload: unknown): DocsLookup | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const root = payload as Record<string, unknown>;
	const results = Array.isArray(root.results)
		? root.results
		: Array.isArray(root.data)
			? root.data
			: [];
	if (results.length === 0) {
		return null;
	}
	const first = results[0];
	if (!first || typeof first !== "object") {
		return null;
	}
	const entry = first as Record<string, unknown>;
	const library_id = extractLibraryId(entry);
	if (!library_id) {
		return null;
	}
	return {
		library_id,
		name: typeof entry.name === "string" ? entry.name : library_id,
		description: typeof entry.description === "string" ? entry.description : "",
	};
}

async function fetchNpmFallback(libraryName: string): Promise<DocsLookup> {
	const npmResponse = await fetch(`https://registry.npmjs.org/${encodeURIComponent(libraryName)}`);
	let description = "";
	if (npmResponse.ok) {
		const npmPayload = (await npmResponse.json()) as Record<string, unknown>;
		description = typeof npmPayload.description === "string" ? npmPayload.description : "";
	}
	return { library_id: `npm/${libraryName}`, name: libraryName, description };
}

async function fetchLibraryDocs(url: string): Promise<LibraryDocs> {
	const response = await fetch(url);
	if (!response.ok) {
		return {
			content: "",
			title: "",
			error: `Request failed: ${response.status} ${response.statusText}`,
		};
	}

	const payload = (await response.json()) as Record<string, unknown>;
	return {
		content: typeof payload.content === "string" ? payload.content : "",
		title: typeof payload.title === "string" ? payload.title : "",
	};
}

export const resolveLibraryIdDefinition: LLMToolDefinition = {
	name: "resolve_library_id",
	description: "Resolve a Context7 library identifier from a library name.",
	input_schema: {
		type: "object",
		properties: {
			library_name: { type: "string", description: "Library or package name" },
		},
		required: ["library_name"],
	},
};

export const queryLibraryDocsDefinition: LLMToolDefinition = {
	name: "query_library_docs",
	description: "Fetch documentation content from Context7 for a library.",
	input_schema: {
		type: "object",
		properties: {
			library_id: { type: "string", description: "Context7 library ID" },
			topic: { type: "string", description: "Optional topic filter" },
			max_tokens: { type: "number", description: "Maximum tokens for docs payload" },
		},
		required: ["library_id"],
	},
};

export function createDocsExecutors(context7BaseUrl = DEFAULT_CONTEXT7_BASE_URL): {
	resolve_library_id: ToolExecutor;
	query_library_docs: ToolExecutor;
} {
	const resolve_library_id: ToolExecutor = async (args, ctx) => {
		if (typeof args.library_name !== "string") {
			return { output: null, durationMs: 0, error: "library_name is required" };
		}

		const libraryName = args.library_name;
		resolveSafePath(ctx.workspaceDir, ".");
		await resolveSafePathStrict(ctx.workspaceDir, ".");

		try {
			const searchUrl = `${context7BaseUrl}/search?q=${encodeURIComponent(libraryName)}&limit=5`;
			const response = await fetch(searchUrl);
			if (response.ok) {
				const payload = await response.json();
				const first = getFirstSearchResult(payload);
				if (first) {
					return { output: first, durationMs: 0 };
				}
			}
		} catch (searchError) {
			void searchError;
		}
		try {
			const fallback = await fetchNpmFallback(libraryName);
			return { output: fallback, durationMs: 0 };
		} catch (err) {
			return {
				output: null,
				durationMs: 0,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	};

	const query_library_docs: ToolExecutor = async (args, ctx) => {
		if (typeof args.library_id !== "string") {
			return { output: null, durationMs: 0, error: "library_id is required" };
		}

		const topic = typeof args.topic === "string" ? args.topic : "";
		const maxTokens = typeof args.max_tokens === "number" ? args.max_tokens : 10_000;

		resolveSafePath(ctx.workspaceDir, ".");
		await resolveSafePathStrict(ctx.workspaceDir, ".");

		try {
			const url =
				`${context7BaseUrl}/libraries/${encodeURIComponent(args.library_id)}` +
				`/docs?topic=${encodeURIComponent(topic)}&tokens=${maxTokens}`;
			const output = await fetchLibraryDocs(url);
			return { output, durationMs: 0 };
		} catch (err) {
			const output: LibraryDocs = {
				content: "",
				title: "",
				error: err instanceof Error ? err.message : String(err),
			};
			return { output, durationMs: 0 };
		}
	};

	return { resolve_library_id, query_library_docs };
}

export const resolveLibraryIdExecutor = createDocsExecutors().resolve_library_id;
export const queryLibraryDocsExecutor = createDocsExecutors().query_library_docs;
