import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePathStrict } from "../workspace.js";

export const fileWriteDefinition: LLMToolDefinition = {
	name: "file_write",
	description:
		"Write content to a file. Creates the file and any parent directories if they don't exist. Overwrites existing content.",
	input_schema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "File path relative to the workspace root",
			},
			content: {
				type: "string",
				description: "The content to write to the file",
			},
		},
		required: ["path", "content"],
	},
};

export const fileWriteExecutor: ToolExecutor = async (args, ctx) => {
	const filePath = args.path as string;
	const content = args.content as string;

	const absPath = await resolveSafePathStrict(ctx.workspaceDir, filePath);
	await mkdir(dirname(absPath), { recursive: true });
	await writeFile(absPath, content, "utf-8");

	return {
		output: { path: filePath, bytes_written: Buffer.byteLength(content, "utf-8") },
		durationMs: 0,
	};
};
