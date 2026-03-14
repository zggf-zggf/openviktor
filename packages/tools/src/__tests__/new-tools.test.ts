import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMProvider } from "@openviktor/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolExecutionContext } from "../registry.js";
import { createAiStructuredOutputExecutor } from "../tools/ai-structured-output.js";
import { createCustomApiIntegrationExecutor } from "../tools/create-custom-api-integration.js";
import { fileToMarkdownExecutor } from "../tools/file-to-markdown.js";
import { createGitExecutors } from "../tools/git.js";
import { createQuickAiSearchExecutor } from "../tools/quick-ai-search.js";
import { workspaceTreeExecutor } from "../tools/workspace-tree.js";

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

describe("file_to_markdown", () => {
	it("returns error for unsupported file extension", async () => {
		await writeFile(join(workspaceDir, "notes.xyz"), "test");
		const result = await fileToMarkdownExecutor({ file_path: "notes.xyz" }, ctx);
		expect(result.error).toContain("Unsupported");
	});

	it("handles pdf conversion when pandoc may be unavailable", async () => {
		await writeFile(join(workspaceDir, "sample.pdf"), "fake-pdf");
		const result = await fileToMarkdownExecutor({ file_path: "sample.pdf" }, ctx);
		if (result.error) {
			expect(typeof result.error).toBe("string");
			return;
		}
		expect(result.output).toBeDefined();
	});
});

describe("create_custom_api_integration", () => {
	it("creates integration config file", async () => {
		const result = await createCustomApiIntegrationExecutor(
			{
				name: "my-app",
				base_url: "https://api.example.com",
				description: "Example integration",
			},
			ctx,
		);

		expect(result.error).toBeUndefined();
		const configPath = join(workspaceDir, ".integrations", "my-app.json");
		const content = await readFile(configPath, "utf-8");
		expect(content).toContain('"name": "my-app"');
	});

	it("rejects invalid name with uppercase", async () => {
		const result = await createCustomApiIntegrationExecutor(
			{
				name: "MyApp",
				base_url: "https://api.example.com",
				description: "Example integration",
			},
			ctx,
		);
		expect(result.error).toContain("Invalid name");
	});

	it("rejects invalid base_url", async () => {
		const result = await createCustomApiIntegrationExecutor(
			{
				name: "my-app",
				base_url: "not-a-url",
				description: "Example integration",
			},
			ctx,
		);
		expect(result.error).toContain("Invalid base_url");
	});

	it("uses default auth_type of bearer", async () => {
		await createCustomApiIntegrationExecutor(
			{
				name: "default-auth",
				base_url: "https://api.example.com",
				description: "Example integration",
			},
			ctx,
		);
		const content = await readFile(
			join(workspaceDir, ".integrations", "default-auth.json"),
			"utf-8",
		);
		const parsed = JSON.parse(content) as { auth_type: string };
		expect(parsed.auth_type).toBe("bearer");
	});
});

describe("workspace_tree", () => {
	it("returns tree string", async () => {
		await writeFile(join(workspaceDir, "a.txt"), "a");
		await mkdir(join(workspaceDir, "src"), { recursive: true });
		await writeFile(join(workspaceDir, "src", "index.ts"), "export {};");

		const result = await workspaceTreeExecutor({}, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { tree: string };
		expect(output.tree).toContain("a.txt");
		expect(output.tree).toContain("src/");
	});

	it("skips node_modules", async () => {
		await mkdir(join(workspaceDir, "node_modules"), { recursive: true });
		await writeFile(join(workspaceDir, "node_modules", "skip.js"), "x");
		const result = await workspaceTreeExecutor({}, ctx);
		const output = result.output as { tree: string };
		expect(output.tree).not.toContain("node_modules");
	});

	it("skips .lock files", async () => {
		await writeFile(join(workspaceDir, "package.lock"), "lock");
		const result = await workspaceTreeExecutor({}, ctx);
		const output = result.output as { tree: string };
		expect(output.tree).not.toContain("package.lock");
	});

	it("marks repos directories", async () => {
		await mkdir(join(workspaceDir, "repos", "myrepo"), { recursive: true });
		const result = await workspaceTreeExecutor({}, ctx);
		const output = result.output as { tree: string };
		expect(output.tree).toContain("myrepo/ (repo)");
	});
});

describe("coworker_git", () => {
	const gitExecutors = createGitExecutors();

	it("runs git version and succeeds", async () => {
		const result = await gitExecutors.coworker_git({ args: ["--version"] }, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { success: boolean; stdout: string };
		expect(output.success).toBe(true);
		expect(output.stdout.toLowerCase()).toContain("git");
	});

	it("returns error for args that are not strings", async () => {
		const result = await gitExecutors.coworker_git({ args: [123] }, ctx);
		expect(result.error).toContain("strings");
	});

	it("returns failed result for bad git command", async () => {
		const result = await gitExecutors.coworker_git({ args: ["invalid-subcmd-xyz"] }, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { success: boolean };
		expect(output.success).toBe(false);
	});
});

describe("quick_ai_search", () => {
	it("returns no-config message when no searchApiKey", async () => {
		const exec = createQuickAiSearchExecutor({});
		const result = await exec({ search_question: "what is TypeScript" }, ctx);
		expect(result.error).toBeUndefined();
		const output = result.output as { search_response: string };
		expect(output.search_response).toContain("SEARCH_API_KEY");
	});

	it("returns error when search_question missing", async () => {
		const exec = createQuickAiSearchExecutor({});
		const result = await exec({}, ctx);
		expect(result.error).toBeDefined();
	});
});

describe("ai_structured_output", () => {
	it("returns error when no prompt", async () => {
		const mockProvider = {
			chat: async () => {
				throw new Error("should not be called");
			},
		} as LLMProvider;
		const exec = createAiStructuredOutputExecutor(mockProvider);
		const result = await exec({}, ctx);
		expect(result.error).toBe("prompt is required");
	});

	it("returns result when LLM returns valid JSON", async () => {
		const mockProvider = {
			chat: async () => ({
				id: "test",
				content: [{ type: "text", text: '{"name":"John"}' }],
				stopReason: "end_turn",
				model: "test",
				inputTokens: 0,
				outputTokens: 0,
				cacheCreationInputTokens: 0,
				cacheReadInputTokens: 0,
				costCents: 0,
			}),
		} as LLMProvider;
		const exec = createAiStructuredOutputExecutor(mockProvider);
		const result = await exec(
			{
				prompt: "extract name",
				output_schema: { type: "object", properties: { name: { type: "string" } } },
			},
			ctx,
		);
		expect(result.error).toBeUndefined();
		const output = result.output as { result: { name: string }; error: string | null };
		expect(output.result).toEqual({ name: "John" });
	});
});
