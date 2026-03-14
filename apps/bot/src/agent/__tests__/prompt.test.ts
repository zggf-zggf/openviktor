import { describe, expect, it } from "vitest";
import { type PromptContext, buildSystemPrompt } from "../prompt.js";

function makeContext(overrides: Partial<PromptContext> = {}): PromptContext {
	return {
		workspaceName: "Acme Corp",
		channel: "C12345",
		triggerType: "MENTION",
		...overrides,
	};
}

describe("buildSystemPrompt", () => {
	it("includes workspace name", () => {
		const prompt = buildSystemPrompt(makeContext({ workspaceName: "Test Workspace" }));
		expect(prompt).toContain('"Test Workspace"');
	});

	it("includes channel", () => {
		const prompt = buildSystemPrompt(makeContext({ channel: "C99999" }));
		expect(prompt).toContain("C99999");
	});

	it("shows 'Channel mention' for MENTION trigger", () => {
		const prompt = buildSystemPrompt(makeContext({ triggerType: "MENTION" }));
		expect(prompt).toContain("Channel mention");
		expect(prompt).not.toContain("Direct message");
	});

	it("shows 'Direct message' for DM trigger", () => {
		const prompt = buildSystemPrompt(makeContext({ triggerType: "DM" }));
		expect(prompt).toContain("Direct message");
		expect(prompt).not.toContain("Channel mention");
	});

	it("includes user name when provided", () => {
		const prompt = buildSystemPrompt(makeContext({ userName: "Alice" }));
		expect(prompt).toContain("Alice");
	});

	it("omits user line when userName is undefined", () => {
		const prompt = buildSystemPrompt(makeContext({ userName: undefined }));
		expect(prompt).not.toContain("- User:");
	});

	it("includes core identity and guidelines", () => {
		const prompt = buildSystemPrompt(makeContext());
		expect(prompt).toContain("OpenViktor");
		expect(prompt).toContain("## Guidelines");
		expect(prompt).toContain("Format responses using Markdown");
	});

	it("includes startup instructions for read_learnings", () => {
		const prompt = buildSystemPrompt(makeContext());
		expect(prompt).toContain("## Startup");
		expect(prompt).toContain("read_learnings");
		expect(prompt).toContain("write_learning");
	});

	it("includes skill catalog when provided", () => {
		const prompt = buildSystemPrompt(
			makeContext({
				skillCatalog: ["team (v2) — Team profiles", "company (v1) — Company context"],
			}),
		);
		expect(prompt).toContain("## Skills");
		expect(prompt).toContain("read_skill");
		expect(prompt).toContain("team (v2) — Team profiles");
		expect(prompt).toContain("company (v1) — Company context");
	});

	it("omits skills section when catalog is empty", () => {
		const prompt = buildSystemPrompt(makeContext({ skillCatalog: [] }));
		expect(prompt).not.toContain("## Skills");
	});

	it("omits skills section when catalog is undefined", () => {
		const prompt = buildSystemPrompt(makeContext());
		expect(prompt).not.toContain("## Skills");
	});

	it("includes skill description format guidance when skills present", () => {
		const prompt = buildSystemPrompt(
			makeContext({ skillCatalog: ["test-skill (v1) — A test skill"] }),
		);
		expect(prompt).toContain("[What it does]. Use when [trigger]. Do NOT use for [anti-trigger].");
	});

	it("includes error handling rules in guidelines", () => {
		const prompt = buildSystemPrompt(makeContext());
		expect(prompt).toContain("Own errors immediately");
		expect(prompt).toContain("Never fabricate URLs or data");
		expect(prompt).toContain("No defensive language");
	});

	it("includes thread info section with thread ID", () => {
		const prompt = buildSystemPrompt(makeContext({ threadId: "thread-123", channel: "C12345" }));
		expect(prompt).toContain("## Your Thread Info");
		expect(prompt).toContain("Thread ID: thread-123");
	});

	it("includes active threads when provided", () => {
		const prompt = buildSystemPrompt(
			makeContext({
				activeThreads: [
					{ path: "C123/ts-001", title: null, status: "ACTIVE" },
					{ path: "C456/ts-002", title: null, status: "ACTIVE" },
				],
			}),
		);
		expect(prompt).toContain("## Currently Active Threads");
		expect(prompt).toContain("- C123/ts-001");
		expect(prompt).toContain("- C456/ts-002");
	});

	it("omits active threads section when empty", () => {
		const prompt = buildSystemPrompt(makeContext({ activeThreads: [] }));
		expect(prompt).not.toContain("## Currently Active Threads");
	});

	it("omits active threads section when undefined", () => {
		const prompt = buildSystemPrompt(makeContext());
		expect(prompt).not.toContain("## Currently Active Threads");
	});
});

describe("buildSystemPrompt — cron", () => {
	it("includes cron job name", () => {
		const prompt = buildSystemPrompt(
			makeContext({ triggerType: "CRON", cronJobName: "daily-report" }),
		);
		expect(prompt).toContain('"daily-report"');
	});

	it("includes error handling rules for cron", () => {
		const prompt = buildSystemPrompt(makeContext({ triggerType: "CRON", cronJobName: "test" }));
		expect(prompt).toContain("Own errors immediately");
		expect(prompt).toContain("Never fabricate URLs or data");
	});

	it("includes first-run marker when cronRunCount is 0", () => {
		const prompt = buildSystemPrompt(
			makeContext({ triggerType: "CRON", cronJobName: "test", cronRunCount: 0 }),
		);
		expect(prompt).toContain("FIRST TIME this cron is running");
	});

	it("omits first-run marker when cronRunCount > 0", () => {
		const prompt = buildSystemPrompt(
			makeContext({ triggerType: "CRON", cronJobName: "test", cronRunCount: 5 }),
		);
		expect(prompt).not.toContain("FIRST TIME");
	});

	it("inlines cron agent prompt as Task section", () => {
		const prompt = buildSystemPrompt(
			makeContext({
				triggerType: "CRON",
				cronJobName: "report",
				cronAgentPrompt: "Generate the weekly summary report.",
			}),
		);
		expect(prompt).toContain("## Task");
		expect(prompt).toContain("Generate the weekly summary report.");
	});

	it("includes thread info and active threads in cron prompt", () => {
		const prompt = buildSystemPrompt(
			makeContext({
				triggerType: "CRON",
				cronJobName: "test",
				threadId: "cron-thread-1",
				activeThreads: [{ path: "C999/ts-active", title: null, status: "ACTIVE" }],
			}),
		);
		expect(prompt).toContain("## Your Thread Info");
		expect(prompt).toContain("Thread ID: cron-thread-1");
		expect(prompt).toContain("## Currently Active Threads");
		expect(prompt).toContain("- C999/ts-active");
	});
});
