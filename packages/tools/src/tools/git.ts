import { spawn } from "node:child_process";
import type { LLMToolDefinition, ToolResult } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePath, resolveSafePathStrict } from "../workspace.js";

const MAX_OUTPUT_BYTES = 32_768;

type CommandOutput = {
	success: boolean;
	stdout: string;
	stderr: string;
	exit_code: number;
};

function truncateOutput(value: string): string {
	if (value.length <= MAX_OUTPUT_BYTES) {
		return value;
	}
	return `${value.slice(0, MAX_OUTPUT_BYTES)}\n... (output truncated)`;
}

async function runCommand(
	bin: "git" | "gh",
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
	timeoutMs = 120_000,
): Promise<ToolResult> {
	return new Promise<ToolResult>((resolve) => {
		const child = spawn(bin, args, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let killed = false;

		const timer = setTimeout(() => {
			killed = true;
			child.kill("SIGKILL");
		}, timeoutMs);

		child.stdout.on("data", (data: Buffer) => {
			if (stdout.length < MAX_OUTPUT_BYTES) {
				stdout += data.toString();
			}
		});

		child.stderr.on("data", (data: Buffer) => {
			if (stderr.length < MAX_OUTPUT_BYTES) {
				stderr += data.toString();
			}
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			if (killed) {
				resolve({
					output: null,
					durationMs: 0,
					error: `${bin} timed out after ${timeoutMs}ms`,
				});
				return;
			}
			const exitCode = code ?? -1;
			const output: CommandOutput = {
				success: exitCode === 0,
				stdout: truncateOutput(stdout),
				stderr: truncateOutput(stderr),
				exit_code: exitCode,
			};
			resolve({ output, durationMs: 0 });
		});

		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ output: null, durationMs: 0, error: `Failed to spawn process: ${err.message}` });
		});
	});
}

export const coworkerGitDefinition: LLMToolDefinition = {
	name: "coworker_git",
	description: "Run a git command in the workspace or a safe subdirectory.",
	input_schema: {
		type: "object",
		properties: {
			args: {
				type: "array",
				items: { type: "string" },
				description: "Git CLI arguments",
			},
			working_dir: {
				type: "string",
				description: "Optional working directory relative to workspace",
			},
		},
		required: ["args"],
	},
};

export const coworkerGithubCliDefinition: LLMToolDefinition = {
	name: "coworker_github_cli",
	description: "Run a GitHub CLI command in the workspace or a safe subdirectory.",
	input_schema: {
		type: "object",
		properties: {
			args: {
				type: "array",
				items: { type: "string" },
				description: "GitHub CLI arguments",
			},
			working_dir: {
				type: "string",
				description: "Optional working directory relative to workspace",
			},
		},
		required: ["args"],
	},
};

export function createGitExecutors(githubToken?: string): {
	coworker_git: ToolExecutor;
	coworker_github_cli: ToolExecutor;
} {
	const coworker_git: ToolExecutor = async (args, ctx) => {
		if (!Array.isArray(args.args) || !args.args.every((item) => typeof item === "string")) {
			return { output: null, durationMs: 0, error: "args must be an array of strings" };
		}

		try {
			const resolvedDir =
				typeof args.working_dir === "string"
					? resolveSafePath(ctx.workspaceDir, args.working_dir)
					: ctx.workspaceDir;
			await resolveSafePathStrict(
				ctx.workspaceDir,
				typeof args.working_dir === "string" ? args.working_dir : ".",
			);
			return runCommand("git", args.args, resolvedDir, {
				...process.env,
				GIT_ASKPASS: "echo",
				GIT_TERMINAL_PROMPT: "0",
				...(githubToken ? { GITHUB_TOKEN: githubToken } : {}),
			});
		} catch (err) {
			return {
				output: null,
				durationMs: 0,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	};

	const coworker_github_cli: ToolExecutor = async (args, ctx) => {
		if (!Array.isArray(args.args) || !args.args.every((item) => typeof item === "string")) {
			return { output: null, durationMs: 0, error: "args must be an array of strings" };
		}

		try {
			const resolvedDir =
				typeof args.working_dir === "string"
					? resolveSafePath(ctx.workspaceDir, args.working_dir)
					: ctx.workspaceDir;
			await resolveSafePathStrict(
				ctx.workspaceDir,
				typeof args.working_dir === "string" ? args.working_dir : ".",
			);
			return runCommand("gh", args.args, resolvedDir, {
				...process.env,
				...(githubToken ? { GH_TOKEN: githubToken } : {}),
				NO_COLOR: "1",
			});
		} catch (err) {
			return {
				output: null,
				durationMs: 0,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	};

	return { coworker_git, coworker_github_cli };
}

export const coworkerGitExecutor = createGitExecutors().coworker_git;
export const coworkerGithubCliExecutor = createGitExecutors().coworker_github_cli;
