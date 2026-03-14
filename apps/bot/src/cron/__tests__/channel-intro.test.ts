import { describe, expect, it } from "vitest";
import { buildChannelIntroPrompt } from "../channel-intro.js";

describe("buildChannelIntroPrompt", () => {
	it("includes run number based on runCount", () => {
		const prompt = buildChannelIntroPrompt(0);
		expect(prompt).toContain("run #1 of 3");

		const prompt2 = buildChannelIntroPrompt(1);
		expect(prompt2).toContain("run #2 of 3");

		const prompt3 = buildChannelIntroPrompt(2);
		expect(prompt3).toContain("run #3 of 3");
	});

	it("includes channel priority order", () => {
		const prompt = buildChannelIntroPrompt(0);
		expect(prompt).toContain("Run #1: Primary/general channel");
		expect(prompt).toContain("Run #2: Most active secondary channel");
		expect(prompt).toContain("Run #3: Next most relevant channel");
	});

	it("references required tools", () => {
		const prompt = buildChannelIntroPrompt(0);
		expect(prompt).toContain("read_learnings");
		expect(prompt).toContain("list_skills");
		expect(prompt).toContain("read_skill");
		expect(prompt).toContain("coworker_list_slack_channels");
		expect(prompt).toContain("coworker_send_slack_message");
		expect(prompt).toContain("coworker_slack_history");
	});

	it("includes tone-matching guidance per channel type", () => {
		const prompt = buildChannelIntroPrompt(0);
		expect(prompt).toContain("Engineering channels");
		expect(prompt).toContain("Marketing/sales channels");
		expect(prompt).toContain("General channels");
		expect(prompt).toContain("Support channels");
	});

	it("includes template rules from Viktor reference", () => {
		const prompt = buildChannelIntroPrompt(0);
		expect(prompt).toContain("Lead with connected integrations");
		expect(prompt).toContain("4-5 concrete capabilities");
		expect(prompt).toContain("try this now");
	});

	it("instructs peer framing (no AI self-intro)", () => {
		const prompt = buildChannelIntroPrompt(0);
		expect(prompt).toContain("DO NOT");
		expect(prompt).toContain("peer framing");
	});

	it("includes self-check to avoid re-introducing", () => {
		const prompt = buildChannelIntroPrompt(0);
		expect(prompt).toContain("already introduced yourself");
		expect(prompt).toContain("already posted");
	});

	it("includes write_learning instruction", () => {
		const prompt = buildChannelIntroPrompt(0);
		expect(prompt).toContain("write_learning");
	});
});
