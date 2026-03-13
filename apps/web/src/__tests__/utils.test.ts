import { describe, expect, it } from "vitest";
import {
	cn,
	formatCost,
	formatDuration,
	formatTokens,
	statusColor,
	threadStatusColor,
} from "../lib/utils";

describe("cn", () => {
	it("merges class names", () => {
		expect(cn("foo", "bar")).toBe("foo bar");
	});

	it("handles conditional classes", () => {
		expect(cn("base", false && "hidden", "visible")).toBe("base visible");
	});

	it("merges conflicting tailwind classes", () => {
		expect(cn("px-4", "px-2")).toBe("px-2");
	});
});

describe("formatCost", () => {
	it("formats zero", () => {
		expect(formatCost(0)).toBe("$0.00");
	});

	it("formats cents to dollars", () => {
		expect(formatCost(150)).toBe("$1.50");
	});

	it("formats fractional cents", () => {
		expect(formatCost(0.5)).toBe("$0.01");
	});
});

describe("formatDuration", () => {
	it("returns dash for null", () => {
		expect(formatDuration(null)).toBe("-");
	});

	it("formats milliseconds", () => {
		expect(formatDuration(500)).toBe("500ms");
	});

	it("formats seconds", () => {
		expect(formatDuration(2500)).toBe("2.5s");
	});

	it("formats minutes", () => {
		expect(formatDuration(90_000)).toBe("1.5m");
	});
});

describe("formatTokens", () => {
	it("formats small numbers", () => {
		expect(formatTokens(500)).toBe("500");
	});

	it("formats thousands", () => {
		expect(formatTokens(1500)).toBe("1.5k");
	});

	it("formats millions", () => {
		expect(formatTokens(1_500_000)).toBe("1.50M");
	});
});

describe("statusColor", () => {
	it("returns correct class for COMPLETED", () => {
		expect(statusColor("COMPLETED")).toContain("emerald");
	});

	it("returns correct class for FAILED", () => {
		expect(statusColor("FAILED")).toContain("red");
	});

	it("returns fallback for unknown status", () => {
		expect(statusColor("UNKNOWN")).toContain("slate");
	});
});

describe("threadStatusColor", () => {
	it("returns correct class for ACTIVE", () => {
		expect(threadStatusColor("ACTIVE")).toContain("emerald");
	});

	it("returns correct class for STALE", () => {
		expect(threadStatusColor("STALE")).toContain("red");
	});
});
