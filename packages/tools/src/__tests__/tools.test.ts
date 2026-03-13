import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolExecutionContext } from "../registry.js";
import { bashExecutor } from "../tools/bash.js";
import { fileEditExecutor } from "../tools/file-edit.js";
import { fileReadExecutor } from "../tools/file-read.js";
import { fileWriteExecutor } from "../tools/file-write.js";
import { globExecutor } from "../tools/glob.js";
import { grepExecutor } from "../tools/grep.js";
import { viewImageExecutor } from "../tools/view-image.js";

let workspaceDir: string;
let ctx: ToolExecutionContext;

beforeEach(async () => {
	workspaceDir = join(tmpdir(), `tool-test-${Date.now()}`);
	await mkdir(workspaceDir, { recursive: true });
	ctx = { workspaceId: "ws_test", workspaceDir, timeoutMs: 30_000 };
});

afterEach(async () => {
	await rm(workspaceDir, { recursive: true, force: true });
});

describe("bash", () => {
	it("executes command and returns stdout", async () => {
		const result = await bashExecutor({ command: "echo hello" }, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { stdout: string; exit_code: number };
		expect(output.stdout.trim()).toBe("hello");
		expect(output.exit_code).toBe(0);
	});

	it("returns stderr and non-zero exit code without setting error", async () => {
		const result = await bashExecutor({ command: "echo err >&2 && exit 42" }, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { stderr: string; exit_code: number };
		expect(output.stderr.trim()).toBe("err");
		expect(output.exit_code).toBe(42);
	});

	it("runs in workspace directory", async () => {
		const result = await bashExecutor({ command: "pwd" }, ctx);
		const output = result.output as { stdout: string };
		expect(output.stdout.trim()).toBe(workspaceDir);
	});

	it("respects timeout", async () => {
		const result = await bashExecutor(
			{ command: "sleep 10", timeout_ms: 100 },
			{ ...ctx, timeoutMs: 200 },
		);
		expect(result.error).toContain("timed out");
	});
});

describe("file_read", () => {
	it("reads file with line numbers", async () => {
		await writeFile(join(workspaceDir, "test.txt"), "line1\nline2\nline3");
		const result = await fileReadExecutor({ path: "test.txt" }, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { content: string; total_lines: number };
		expect(output.content).toContain("1\tline1");
		expect(output.content).toContain("2\tline2");
		expect(output.total_lines).toBe(3);
	});

	it("supports offset and limit", async () => {
		await writeFile(join(workspaceDir, "test.txt"), "a\nb\nc\nd\ne");
		const result = await fileReadExecutor({ path: "test.txt", offset: 2, limit: 2 }, ctx);
		const output = result.output as { content: string; lines_shown: number };
		expect(output.lines_shown).toBe(2);
		expect(output.content).toContain("2\tb");
		expect(output.content).toContain("3\tc");
		expect(output.content).not.toContain("1\ta");
	});

	it("rejects path traversal", async () => {
		await expect(fileReadExecutor({ path: "../../etc/passwd" }, ctx)).rejects.toThrow(
			"Path escapes workspace",
		);
	});
});

describe("file_write", () => {
	it("creates file with content", async () => {
		const result = await fileWriteExecutor({ path: "out.txt", content: "hello world" }, ctx);
		expect(result.error).toBeUndefined();
		const written = await readFile(join(workspaceDir, "out.txt"), "utf-8");
		expect(written).toBe("hello world");
	});

	it("creates parent directories", async () => {
		await fileWriteExecutor({ path: "deep/nested/file.txt", content: "nested" }, ctx);
		const written = await readFile(join(workspaceDir, "deep/nested/file.txt"), "utf-8");
		expect(written).toBe("nested");
	});

	it("rejects path outside workspace", async () => {
		await expect(fileWriteExecutor({ path: "/etc/evil", content: "hack" }, ctx)).rejects.toThrow();
	});
});

describe("file_edit", () => {
	it("replaces exact string", async () => {
		await writeFile(join(workspaceDir, "edit.txt"), "hello world");
		const result = await fileEditExecutor(
			{ path: "edit.txt", old_string: "world", new_string: "earth" },
			ctx,
		);
		expect(result.error).toBeUndefined();
		const content = await readFile(join(workspaceDir, "edit.txt"), "utf-8");
		expect(content).toBe("hello earth");
	});

	it("errors when old_string not found", async () => {
		await writeFile(join(workspaceDir, "edit.txt"), "hello world");
		const result = await fileEditExecutor(
			{ path: "edit.txt", old_string: "missing", new_string: "x" },
			ctx,
		);
		expect(result.error).toContain("not found");
	});

	it("errors on ambiguous match without replace_all", async () => {
		await writeFile(join(workspaceDir, "edit.txt"), "aaa bbb aaa");
		const result = await fileEditExecutor(
			{ path: "edit.txt", old_string: "aaa", new_string: "x" },
			ctx,
		);
		expect(result.error).toContain("multiple locations");
	});

	it("replaces all occurrences with replace_all", async () => {
		await writeFile(join(workspaceDir, "edit.txt"), "aaa bbb aaa");
		const result = await fileEditExecutor(
			{ path: "edit.txt", old_string: "aaa", new_string: "x", replace_all: true },
			ctx,
		);
		expect(result.error).toBeUndefined();
		const content = await readFile(join(workspaceDir, "edit.txt"), "utf-8");
		expect(content).toBe("x bbb x");
		expect((result.output as { replacements: number }).replacements).toBe(2);
	});
});

describe("glob", () => {
	it("finds files matching pattern", async () => {
		await writeFile(join(workspaceDir, "a.ts"), "");
		await writeFile(join(workspaceDir, "b.ts"), "");
		await writeFile(join(workspaceDir, "c.js"), "");
		const result = await globExecutor({ pattern: "*.ts" }, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { files: string[]; count: number };
		expect(output.count).toBe(2);
		expect(output.files).toContain("a.ts");
		expect(output.files).toContain("b.ts");
		expect(output.files).not.toContain("c.js");
	});
});

describe("grep", () => {
	it("searches file contents with regex", async () => {
		await writeFile(
			join(workspaceDir, "code.ts"),
			'const x = 1;\nconst y = "hello";\nconst z = 2;',
		);
		const result = await grepExecutor({ pattern: "const [xy]" }, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { content: string };
		expect(output.content).toContain("const x");
		expect(output.content).toContain("const y");
	});

	it("returns empty content for no matches", async () => {
		await writeFile(join(workspaceDir, "code.ts"), "hello");
		const result = await grepExecutor({ pattern: "zzzzz" }, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { match_count?: number; content: string };
		expect(output.content || "").toBe("");
	});
});

describe("view_image", () => {
	it("reads image file and returns base64", async () => {
		const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		await writeFile(join(workspaceDir, "test.png"), pngHeader);
		const result = await viewImageExecutor({ path: "test.png" }, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { mime_type: string; base64: string };
		expect(output.mime_type).toBe("image/png");
		expect(output.base64).toBe(pngHeader.toString("base64"));
	});

	it("rejects unsupported format", async () => {
		await writeFile(join(workspaceDir, "test.pdf"), "fake");
		const result = await viewImageExecutor({ path: "test.pdf" }, ctx);
		expect(result.error).toContain("Unsupported image format");
	});
});
