import { spawn } from "node:child_process";
import type { LLMToolDefinition, ToolResult } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePath } from "../workspace.js";

const MAX_RESULTS = 500;

export const globDefinition: LLMToolDefinition = {
	name: "glob",
	description:
		"Find files matching a glob pattern within the workspace. Returns sorted file paths.",
	input_schema: {
		type: "object",
		properties: {
			pattern: {
				type: "string",
				description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.json")',
			},
			path: {
				type: "string",
				description: "Directory to search in (relative to workspace, default: workspace root)",
			},
		},
		required: ["pattern"],
	},
};

export const globExecutor: ToolExecutor = async (args, ctx) => {
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

	return new Promise<ToolResult>((resolve) => {
		const child = spawn("find", [searchPath, "-maxdepth", "10", "-type", "f", "-name", pattern], {
			cwd: ctx.workspaceDir,
			timeout: 30_000,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		child.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		let stderr = "";
		child.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			if (code !== 0 && stderr.trim()) {
				resolve({ output: null, durationMs: 0, error: `Glob failed: ${stderr.trim()}` });
				return;
			}

			const prefix = ctx.workspaceDir.endsWith("/") ? ctx.workspaceDir : `${ctx.workspaceDir}/`;
			const files = stdout
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f))
				.sort()
				.slice(0, MAX_RESULTS);

			resolve({
				output: {
					files,
					count: files.length,
					truncated: files.length >= MAX_RESULTS,
				},
				durationMs: 0,
			});
		});

		child.on("error", (err) => {
			resolve({
				output: null,
				durationMs: 0,
				error: `Glob failed: ${err.message}`,
			});
		});
	});
};
