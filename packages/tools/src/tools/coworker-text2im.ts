import type { LLMToolDefinition, ToolResult } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";

export const coworkerText2ImDefinition: LLMToolDefinition = {
	name: "coworker_text2im",
	description: "Generate an image from a text prompt.",
	input_schema: {
		type: "object",
		properties: {
			prompt: {
				type: "string",
				description: "Image generation prompt",
			},
			width: {
				type: "number",
				description: "Output image width (default: 1024)",
			},
			height: {
				type: "number",
				description: "Output image height (default: 1024)",
			},
			style: {
				type: "string",
				description: "Optional visual style hint",
			},
		},
		required: ["prompt"],
	},
};

type Text2ImArgs = {
	prompt: string;
	width: number;
	height: number;
	style?: string;
};

function makeNotConfiguredResponse(): ToolResult {
	return {
		output: { error: "Image generation requires IMAGEN_API_KEY to be configured" },
		durationMs: 0,
	};
}

function parseText2ImArgs(args: Record<string, unknown>): Text2ImArgs | null {
	if (typeof args.prompt !== "string" || args.prompt.length === 0) {
		return null;
	}

	return {
		prompt: args.prompt,
		width: typeof args.width === "number" ? args.width : 1024,
		height: typeof args.height === "number" ? args.height : 1024,
		style: typeof args.style === "string" ? args.style : undefined,
	};
}

function makeStubResponse(request: Text2ImArgs): ToolResult {
	return {
		output: {
			error: "Image generation requires IMAGEN_API_KEY to be configured",
			request: {
				provider: "imagen",
				prompt: request.prompt,
				width: request.width,
				height: request.height,
				style: request.style,
			},
			stub: "Image API call is intentionally stubbed and not executed",
		},
		durationMs: 0,
	};
}

export function createText2ImExecutor(imagenApiKey?: string): ToolExecutor {
	return async (args) => {
		const request = parseText2ImArgs(args);
		if (!request) {
			return { output: null, durationMs: 0, error: "prompt is required" };
		}
		if (!imagenApiKey) {
			return makeNotConfiguredResponse();
		}
		return makeStubResponse(request);
	};
}

export const coworkerText2ImExecutor: ToolExecutor = createText2ImExecutor(undefined);
