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
});
