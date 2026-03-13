import { spawn } from "node:child_process";
import type { LLMToolDefinition, ToolResult } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";

const MAX_OUTPUT_BYTES = 32_768;

export const bashDefinition: LLMToolDefinition = {
	name: "bash",
	description:
		"Execute a shell command. The command runs in the workspace directory. Use this for system operations, package management, running scripts, etc.",
	input_schema: {
		type: "object",
		properties: {
			command: {
				type: "string",
				description: "The shell command to execute",
			},
			timeout_ms: {
				type: "number",
				description: "Timeout in milliseconds (default: 120000, max: 600000)",
			},
		},
		required: ["command"],
	},
};

export const bashExecutor: ToolExecutor = async (args, ctx) => {
	const command = args.command as string;
	const timeoutMs = Math.min(
		typeof args.timeout_ms === "number" ? args.timeout_ms : 120_000,
		ctx.timeoutMs,
	);

	return new Promise<ToolResult>((resolve) => {
		const child = spawn("bash", ["-c", command], {
			cwd: ctx.workspaceDir,
			timeout: timeoutMs,
			env: { ...process.env, HOME: ctx.workspaceDir },
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let stdoutTruncated = false;
		let stderrTruncated = false;

		child.stdout.on("data", (data: Buffer) => {
			if (stdout.length < MAX_OUTPUT_BYTES) {
				stdout += data.toString();
				if (stdout.length > MAX_OUTPUT_BYTES) {
					stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
					stdoutTruncated = true;
				}
			}
		});

		child.stderr.on("data", (data: Buffer) => {
			if (stderr.length < MAX_OUTPUT_BYTES) {
				stderr += data.toString();
				if (stderr.length > MAX_OUTPUT_BYTES) {
					stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
					stderrTruncated = true;
				}
			}
		});

		child.on("close", (code, signal) => {
			const output: Record<string, unknown> = {
				exit_code: code ?? -1,
				stdout: stdout + (stdoutTruncated ? "\n... (output truncated)" : ""),
				stderr: stderr + (stderrTruncated ? "\n... (output truncated)" : ""),
			};

			if (signal === "SIGTERM") {
				resolve({
					output,
					durationMs: 0,
					error: `Command timed out after ${timeoutMs}ms`,
				});
				return;
			}

			resolve({ output, durationMs: 0 });
		});

		child.on("error", (err) => {
			resolve({
				output: null,
				durationMs: 0,
				error: `Failed to spawn process: ${err.message}`,
			});
		});
	});
};
