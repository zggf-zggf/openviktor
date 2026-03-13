import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePathStrict } from "../workspace.js";

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3 MB

const MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".bmp": "image/bmp",
};

export const viewImageDefinition: LLMToolDefinition = {
	name: "view_image",
	description:
		"Read an image file and return its base64-encoded content. Supports PNG, JPG, GIF, WebP, SVG, BMP.",
	input_schema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "Image file path relative to the workspace root",
			},
		},
		required: ["path"],
	},
};

export const viewImageExecutor: ToolExecutor = async (args, ctx) => {
	const filePath = args.path as string;
	const absPath = await resolveSafePathStrict(ctx.workspaceDir, filePath);

	const ext = extname(absPath).toLowerCase();
	const mimeType = MIME_TYPES[ext];
	if (!mimeType) {
		return {
			output: null,
			durationMs: 0,
			error: `Unsupported image format: ${ext}. Supported: ${Object.keys(MIME_TYPES).join(", ")}`,
		};
	}

	const fileStat = await stat(absPath);
	if (fileStat.size > MAX_FILE_SIZE) {
		return {
			output: null,
			durationMs: 0,
			error: `File too large: ${(fileStat.size / 1024 / 1024).toFixed(1)}MB (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
		};
	}

	const buffer = await readFile(absPath);
	const base64 = buffer.toString("base64");

	return {
		output: {
			mime_type: mimeType,
			base64,
			size_bytes: fileStat.size,
		},
		durationMs: 0,
	};
};
