import { readFile, writeFile } from "node:fs/promises";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePathStrict } from "../workspace.js";

export const fileEditDefinition: LLMToolDefinition = {
	name: "file_edit",
	description:
		"Perform exact string replacement in a file. The old_string must match exactly (including whitespace). Use replace_all to replace all occurrences.",
	input_schema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "File path relative to the workspace root",
			},
			old_string: {
				type: "string",
				description: "The exact text to find and replace",
			},
			new_string: {
				type: "string",
				description: "The replacement text",
			},
			replace_all: {
				type: "boolean",
				description: "Replace all occurrences (default: false)",
			},
		},
		required: ["path", "old_string", "new_string"],
	},
};

export const fileEditExecutor: ToolExecutor = async (args, ctx) => {
	const filePath = args.path as string;
	const oldString = args.old_string as string;
	const newString = args.new_string as string;
	const replaceAll = args.replace_all === true;

	if (oldString.length === 0) {
		return { output: null, durationMs: 0, error: "old_string must not be empty" };
	}

	const absPath = await resolveSafePathStrict(ctx.workspaceDir, filePath);
	const content = await readFile(absPath, "utf-8");

	if (!content.includes(oldString)) {
		return {
			output: null,
			durationMs: 0,
			error: "old_string not found in file",
		};
	}

	if (!replaceAll) {
		const firstIdx = content.indexOf(oldString);
		const secondIdx = content.indexOf(oldString, firstIdx + 1);
		if (secondIdx !== -1) {
			return {
				output: null,
				durationMs: 0,
				error:
					"old_string matches multiple locations. Provide more context to make it unique, or set replace_all to true.",
			};
		}
	}

	const updated = replaceAll
		? content.replaceAll(oldString, newString)
		: content.replace(oldString, newString);

	await writeFile(absPath, updated, "utf-8");

	const count = replaceAll ? content.split(oldString).length - 1 : 1;

	return {
		output: { path: filePath, replacements: count },
		durationMs: 0,
	};
};
