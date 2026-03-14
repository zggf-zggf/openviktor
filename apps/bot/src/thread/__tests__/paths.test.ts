import { describe, expect, it } from "vitest";
import {
	generateCronThreadPath,
	generateSlackThreadPath,
	generateSpawnPath,
	isChildPath,
} from "../paths.js";

describe("generateSlackThreadPath", () => {
	it("generates path from user ID and thread timestamp", () => {
		const path = generateSlackThreadPath("U12345", "1710000000.000100");
		expect(path).toBe("/slack/U12345/1710000000.000100");
	});
});

describe("generateCronThreadPath", () => {
	it("generates path with lowercase cron name and ISO timestamp", () => {
		const path = generateCronThreadPath("Heartbeat");
		expect(path).toMatch(/^\/heartbeat\/threads\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
	});
});

describe("generateSpawnPath", () => {
	it("appends child name under parent threads directory", () => {
		const path = generateSpawnPath("/heartbeat", "crypto_research");
		expect(path).toBe("/heartbeat/threads/crypto_research");
	});

	it("supports nested spawning", () => {
		const path = generateSpawnPath("/heartbeat/threads/research", "sub_task");
		expect(path).toBe("/heartbeat/threads/research/threads/sub_task");
	});

	it("normalizes trailing slashes on parent path", () => {
		const path = generateSpawnPath("/heartbeat/", "research");
		expect(path).toBe("/heartbeat/threads/research");
	});

	it("strips leading/trailing slashes from child name", () => {
		const path = generateSpawnPath("/heartbeat", "/research/");
		expect(path).toBe("/heartbeat/threads/research");
	});

	it("throws for empty child name", () => {
		expect(() => generateSpawnPath("/heartbeat", "")).toThrow("childName cannot be empty");
	});
});

describe("isChildPath", () => {
	it("returns true for direct child paths", () => {
		expect(isChildPath("/heartbeat", "/heartbeat/threads/research")).toBe(true);
	});

	it("returns false for unrelated paths", () => {
		expect(isChildPath("/heartbeat", "/slack/user/123")).toBe(false);
	});

	it("returns false for the parent path itself", () => {
		expect(isChildPath("/heartbeat", "/heartbeat")).toBe(false);
	});
});
