import { describe, expect, it } from "vitest";
import { chunkMessage, markdownToMrkdwn } from "./mrkdwn.js";

describe("markdownToMrkdwn", () => {
	it("returns empty string for empty input", () => {
		expect(markdownToMrkdwn("")).toBe("");
	});

	it("returns plain text unchanged", () => {
		expect(markdownToMrkdwn("hello world")).toBe("hello world");
	});

	describe("bold", () => {
		it("converts **text** to *text*", () => {
			expect(markdownToMrkdwn("this is **bold** text")).toBe("this is *bold* text");
		});

		it("handles multiple bold spans", () => {
			expect(markdownToMrkdwn("**one** and **two**")).toBe("*one* and *two*");
		});

		it("handles bold with punctuation", () => {
			expect(markdownToMrkdwn("**bold!** right?")).toBe("*bold!* right?");
		});
	});

	describe("italic", () => {
		it("converts *text* to _text_", () => {
			expect(markdownToMrkdwn("this is *italic* text")).toBe("this is _italic_ text");
		});

		it("does not convert multiplication like 2 * 3 * 4", () => {
			expect(markdownToMrkdwn("2 * 3 * 4")).toBe("2 * 3 * 4");
		});

		it("handles single-character italic", () => {
			expect(markdownToMrkdwn("*a*")).toBe("_a_");
		});
	});

	describe("bold + italic", () => {
		it("converts ***text*** to *_text_*", () => {
			expect(markdownToMrkdwn("***bold and italic***")).toBe("*_bold and italic_*");
		});
	});

	describe("links", () => {
		it("converts [text](url) to <url|text>", () => {
			expect(markdownToMrkdwn("[click here](https://example.com)")).toBe(
				"<https://example.com|click here>",
			);
		});

		it("handles multiple links", () => {
			expect(markdownToMrkdwn("[a](https://a.com) and [b](https://b.com)")).toBe(
				"<https://a.com|a> and <https://b.com|b>",
			);
		});
	});

	describe("images", () => {
		it("converts ![alt](url) to <url|alt>", () => {
			expect(markdownToMrkdwn("![logo](https://img.com/logo.png)")).toBe(
				"<https://img.com/logo.png|logo>",
			);
		});

		it("handles empty alt text", () => {
			expect(markdownToMrkdwn("![](https://img.com/pic.png)")).toBe("<https://img.com/pic.png|>");
		});
	});

	describe("headings", () => {
		it("converts # heading to *heading*", () => {
			expect(markdownToMrkdwn("# Title")).toBe("*Title*");
		});

		it("converts ## through ###### headings", () => {
			expect(markdownToMrkdwn("## Subtitle")).toBe("*Subtitle*");
			expect(markdownToMrkdwn("### Section")).toBe("*Section*");
			expect(markdownToMrkdwn("###### Deep")).toBe("*Deep*");
		});

		it("strips bold markers inside headings", () => {
			expect(markdownToMrkdwn("# **Important** Section")).toBe("*Important Section*");
		});

		it("preserves non-heading # characters", () => {
			expect(markdownToMrkdwn("issue #42 is fixed")).toBe("issue #42 is fixed");
		});
	});

	describe("strikethrough", () => {
		it("converts ~~text~~ to ~text~", () => {
			expect(markdownToMrkdwn("~~deleted~~")).toBe("~deleted~");
		});
	});

	describe("horizontal rules", () => {
		it("converts --- to unicode line", () => {
			expect(markdownToMrkdwn("above\n---\nbelow")).toBe("above\n─────────────────\nbelow");
		});

		it("converts *** to unicode line", () => {
			expect(markdownToMrkdwn("above\n***\nbelow")).toBe("above\n─────────────────\nbelow");
		});
	});

	describe("code blocks", () => {
		it("preserves fenced code blocks unchanged", () => {
			const input = "before\n```\nconst x = **y**;\n```\nafter **bold**";
			const result = markdownToMrkdwn(input);
			expect(result).toContain("```\nconst x = **y**;\n```");
			expect(result).toContain("after *bold*");
		});

		it("preserves code blocks with language tag", () => {
			const input = "```typescript\nconst a = [link](url);\n```";
			expect(markdownToMrkdwn(input)).toBe(input);
		});
	});

	describe("inline code", () => {
		it("preserves inline code unchanged", () => {
			expect(markdownToMrkdwn("run `**not bold**` here")).toBe("run `**not bold**` here");
		});

		it("preserves inline code with links", () => {
			expect(markdownToMrkdwn("use `[text](url)` syntax")).toBe("use `[text](url)` syntax");
		});
	});

	describe("blockquotes", () => {
		it("preserves blockquotes (same syntax)", () => {
			expect(markdownToMrkdwn("> quoted text")).toBe("> quoted text");
		});
	});

	describe("nested formatting", () => {
		it("handles bold inside a sentence with links", () => {
			const input = "Check **this** and [docs](https://docs.com)";
			expect(markdownToMrkdwn(input)).toBe("Check *this* and <https://docs.com|docs>");
		});

		it("handles complex mixed formatting", () => {
			const input = [
				"# Getting Started",
				"",
				"Here's some **important** info with *emphasis*.",
				"",
				"Check [the docs](https://docs.com) for details.",
				"",
				"```",
				"code stays unchanged",
				"```",
			].join("\n");

			const result = markdownToMrkdwn(input);
			expect(result).toContain("*Getting Started*");
			expect(result).toContain("*important*");
			expect(result).toContain("_emphasis_");
			expect(result).toContain("<https://docs.com|the docs>");
			expect(result).toContain("```\ncode stays unchanged\n```");
		});
	});

	describe("real LLM output", () => {
		it("handles typical Claude response", () => {
			const input = [
				"## Summary",
				"",
				"Here's what I found:",
				"",
				"1. **TypeScript** is a typed superset of JavaScript",
				"2. It compiles to plain JS via `tsc`",
				"3. See the [official docs](https://typescriptlang.org) for more",
				"",
				"> Note: TypeScript is *not* the same as CoffeeScript",
				"",
				"---",
				"",
				"Let me know if you need ~~more info~~ anything else!",
			].join("\n");

			const result = markdownToMrkdwn(input);
			expect(result).toContain("*Summary*");
			expect(result).toContain("*TypeScript*");
			expect(result).toContain("`tsc`");
			expect(result).toContain("<https://typescriptlang.org|official docs>");
			expect(result).toContain("_not_");
			expect(result).toContain("─────────────────");
			expect(result).toContain("~more info~");
		});
	});
});

describe("chunkMessage", () => {
	it("returns single chunk for short messages", () => {
		expect(chunkMessage("hello")).toEqual(["hello"]);
	});

	it("returns original text when under max length", () => {
		const text = "a".repeat(3000);
		expect(chunkMessage(text)).toEqual([text]);
	});

	it("splits at paragraph boundary", () => {
		const para1 = "a".repeat(2000);
		const para2 = "b".repeat(2000);
		const text = `${para1}\n\n${para2}`;
		const chunks = chunkMessage(text);

		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toBe(para1);
		expect(chunks[1]).toBe(para2);
	});

	it("splits at line boundary when no paragraph break", () => {
		const line1 = "a".repeat(2000);
		const line2 = "b".repeat(2000);
		const text = `${line1}\n${line2}`;
		const chunks = chunkMessage(text);

		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toBe(line1);
		expect(chunks[1]).toBe(line2);
	});

	it("splits at word boundary when no line break", () => {
		const word = "hello ";
		const count = Math.ceil(3001 / word.length);
		const text = word.repeat(count).trim();
		const chunks = chunkMessage(text);

		expect(chunks.length).toBeGreaterThanOrEqual(2);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(3000);
		}
	});

	it("hard-cuts when no natural boundary", () => {
		const text = "a".repeat(6000);
		const chunks = chunkMessage(text);

		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toBe("a".repeat(3000));
		expect(chunks[1]).toBe("a".repeat(3000));
	});

	it("throws on non-positive maxLength", () => {
		expect(() => chunkMessage("hello", 0)).toThrow("maxLength must be a positive integer");
		expect(() => chunkMessage("hello", -1)).toThrow("maxLength must be a positive integer");
	});

	it("respects custom max length", () => {
		const text = "abcdefghij";
		const chunks = chunkMessage(text, 5);
		expect(chunks).toHaveLength(2);
	});
});
