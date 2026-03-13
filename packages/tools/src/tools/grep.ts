import { spawn } from "node:child_process";
import type { LLMToolDefinition, ToolResult } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePath } from "../workspace.js";

const MAX_OUTPUT_BYTES = 32_768;

export const grepDefinition: LLMToolDefinition = {
	name: "grep",
	description:
		"Search file contents using ripgrep (rg). Supports regex patterns, file type filtering, and context lines.",
	input_schema: {
		type: "object",
		properties: {
			pattern: {
				type: "string",
				description: "Regex pattern to search for",
			},
			path: {
				type: "string",
				description: "File or directory to search (relative to workspace, default: workspace root)",
			},
			include: {
				type: "string",
				description: 'Glob pattern to filter files (e.g. "*.ts")',
			},
			context: {
				type: "number",
				description: "Number of context lines before and after each match",
			},
			max_count: {
				type: "number",
				description: "Maximum number of matches per file",
			},
			case_insensitive: {
				type: "boolean",
				description: "Case-insensitive search (default: false)",
			},
		},
		required: ["pattern"],
	},
};

export const grepExecutor: ToolExecutor = async (args, ctx) => {
	const pattern = args.pattern as string;
	let searchPath: string;
	try {
		searchPath =
			typeof args.path === "string"
				? resolveSafePath(ctx.workspaceDir, args.path)
				: ctx.workspaceDir;
	} catch (err) {
		return { output: null, durationMs: 0, error: err instanceof Error ? err.message : String(err) };
	}

	const rgArgs = ["--color", "never", "--line-number"];

	if (typeof args.include === "string") {
		rgArgs.push("--glob", args.include);
	}
	if (typeof args.context === "number") {
		rgArgs.push("-C", String(args.context));
	}
	if (typeof args.max_count === "number") {
		rgArgs.push("-m", String(args.max_count));
	}
	if (args.case_insensitive === true) {
		rgArgs.push("-i");
	}

	rgArgs.push("--", pattern, searchPath);

	return new Promise<ToolResult>((resolve) => {
		const child = spawn("rg", rgArgs, {
			cwd: ctx.workspaceDir,
			timeout: 30_000,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let truncated = false;
		child.stdout.on("data", (data: Buffer) => {
			if (stdout.length < MAX_OUTPUT_BYTES) {
				stdout += data.toString();
				if (stdout.length > MAX_OUTPUT_BYTES) {
					stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
					truncated = true;
					child.kill("SIGTERM");
				}
			}
		});

		let stderr = "";
		child.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			const prefix = ctx.workspaceDir.endsWith("/") ? ctx.workspaceDir : `${ctx.workspaceDir}/`;
			const content = stdout.replace(new RegExp(escapeRegex(prefix), "g"), "");

			if (code === 1 && !stdout) {
				resolve({
					output: { content: "", match_count: 0 },
					durationMs: 0,
				});
				return;
			}

			if (code !== 0 && code !== 1 && stderr) {
				resolve({
					output: null,
					durationMs: 0,
					error: `Grep failed: ${stderr.trim()}`,
				});
				return;
			}

			resolve({
				output: {
					content: content + (truncated ? "\n... (output truncated)" : ""),
					truncated,
				},
				durationMs: 0,
			});
		});

		child.on("error", (err) => {
			resolve({
				output: null,
				durationMs: 0,
				error: `Grep failed: ${err.message}`,
			});
		});
	});
};

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
