import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePathStrict } from "../workspace.js";

const MAX_OUTPUT_BYTES = 32_768;

const EXTENSION_TO_FORMAT: Record<string, string> = {
	pdf: "pdf",
	docx: "docx",
	xlsx: "xlsx",
	xls: "xls",
	pptx: "pptx",
	ppt: "ppt",
	rtf: "rtf",
	odt: "odt",
	ods: "ods",
	odp: "odp",
};

export const fileToMarkdownDefinition: LLMToolDefinition = {
	name: "file_to_markdown",
	description:
		"Convert supported office and document files to markdown. Supports: pdf, docx, xlsx, xls, pptx, ppt, rtf, odt, ods, odp.",
	input_schema: {
		type: "object",
		properties: {
			file_path: {
				type: "string",
				description: "Path to the file relative to the workspace root",
			},
		},
		required: ["file_path"],
	},
};

export const fileToMarkdownExecutor: ToolExecutor = async (args, ctx) => {
	try {
		if (typeof args.file_path !== "string" || args.file_path.length === 0) {
			return { output: null, durationMs: 0, error: "file_path is required" };
		}

		const filePath = await resolveSafePathStrict(ctx.workspaceDir, args.file_path);
		const fileStat = await stat(filePath);
		if (!fileStat.isFile()) {
			return { output: null, durationMs: 0, error: `Not a file: ${args.file_path}` };
		}

		const extension = getExtension(args.file_path);
		const format = EXTENSION_TO_FORMAT[extension];
		if (!format) {
			return {
				output: null,
				durationMs: 0,
				error:
					"Unsupported file format. Supported formats: .pdf, .docx, .xlsx, .xls, .pptx, .ppt, .rtf, .odt, .ods, .odp",
			};
		}
		const pandocResult = await runProcess("pandoc", [
			`--from=${format}`,
			"--to=markdown",
			filePath,
		]);

		if (!pandocResult.error) {
			return {
				output: {
					content: truncateOutput(pandocResult.stdout),
					format,
				},
				durationMs: 0,
			};
		}

		if (pandocResult.spawnErrorCode === "ENOENT") {
			return { output: null, durationMs: 0, error: "pandoc is required for file conversion" };
		}

		if (format === "pdf") {
			const pdfTextResult = await runProcess("pdftotext", [filePath, "-"]);
			if (!pdfTextResult.error) {
				return {
					output: {
						content: truncateOutput(pdfTextResult.stdout),
						format,
					},
					durationMs: 0,
				};
			}
		}

		return {
			output: null,
			durationMs: 0,
			error: pandocResult.error ?? "File conversion failed",
		};
	} catch (error) {
		return {
			output: null,
			durationMs: 0,
			error: error instanceof Error ? error.message : String(error),
		};
	}
};

function getExtension(filePath: string): string {
	const index = filePath.lastIndexOf(".");
	if (index < 0) {
		return "";
	}
	return filePath.slice(index + 1).toLowerCase();
}

function truncateOutput(text: string): string {
	if (text.length <= MAX_OUTPUT_BYTES) {
		return text;
	}
	return `${text.slice(0, MAX_OUTPUT_BYTES)}\n... (output truncated)`;
}

async function runProcess(
	command: string,
	args: string[],
): Promise<{
	stdout: string;
	stderr: string;
	error?: string;
	spawnErrorCode?: string;
}> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		child.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}
			resolve({
				stdout,
				stderr,
				error: stderr.trim() || `${command} failed with exit code ${code ?? -1}`,
			});
		});

		child.on("error", (err: NodeJS.ErrnoException) => {
			resolve({
				stdout,
				stderr,
				error: err.message,
				spawnErrorCode: err.code,
			});
		});
	});
}
