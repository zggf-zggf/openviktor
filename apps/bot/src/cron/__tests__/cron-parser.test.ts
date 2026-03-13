import { describe, expect, it } from "vitest";
import { calculateNextRun, estimateRunsPerDay, isValidCronExpression } from "../cron-parser.js";

describe("isValidCronExpression", () => {
	it("accepts standard 5-field expressions", () => {
		expect(isValidCronExpression("* * * * *")).toBe(true);
		expect(isValidCronExpression("0 9 * * 1")).toBe(true);
		expect(isValidCronExpression("1 8,11,14,17 * * 1-5")).toBe(true);
		expect(isValidCronExpression("*/15 * * * *")).toBe(true);
		expect(isValidCronExpression("0 0 1 1 *")).toBe(true);
	});

	it("rejects invalid expressions", () => {
		expect(isValidCronExpression("not a cron")).toBe(false);
		expect(isValidCronExpression("* * * * * * * *")).toBe(false);
	});
});

describe("calculateNextRun", () => {
	it("calculates next run from a given date", () => {
		// Monday 9am weekly — from a Wednesday
		const wednesday = new Date("2026-03-11T10:00:00Z"); // Wednesday
		const next = calculateNextRun("0 9 * * 1", wednesday);
		expect(next.getDay()).toBe(1); // Monday
		expect(next.getHours()).toBe(9);
		expect(next > wednesday).toBe(true);
	});

	it("returns next minute for every-minute cron", () => {
		const now = new Date("2026-03-13T12:00:00Z");
		const next = calculateNextRun("* * * * *", now);
		expect(next.getTime() - now.getTime()).toBe(60_000);
	});

	it("handles heartbeat schedule (4x/day weekdays)", () => {
		// Friday at 7am — next should be 8:01
		const friday = new Date("2026-03-13T07:00:00Z");
		const next = calculateNextRun("1 8,11,14,17 * * 1-5", friday);
		expect(next.getHours()).toBe(8);
		expect(next.getMinutes()).toBe(1);
	});

	it("handles end-of-month edge case", () => {
		const feb28 = new Date("2026-02-28T23:00:00Z");
		const next = calculateNextRun("0 9 1 * *", feb28);
		expect(next.getDate()).toBe(1);
		expect(next.getMonth()).toBe(2); // March
	});
});

describe("estimateRunsPerDay", () => {
	it("estimates ~1440 runs for every-minute cron", () => {
		const runs = estimateRunsPerDay("* * * * *");
		expect(runs).toBeGreaterThanOrEqual(1439);
		expect(runs).toBeLessThanOrEqual(1440);
	});

	it("estimates ~24 runs for hourly cron", () => {
		const runs = estimateRunsPerDay("0 * * * *");
		expect(runs).toBeGreaterThanOrEqual(23);
		expect(runs).toBeLessThanOrEqual(24);
	});

	it("estimates 4 for heartbeat schedule on weekday", () => {
		// This depends on what day the test runs — heartbeat is weekdays only
		const runs = estimateRunsPerDay("1 8,11,14,17 * * 1-5");
		const today = new Date().getDay();
		const isWeekday = today >= 1 && today <= 5;
		expect(runs).toBe(isWeekday ? 4 : 0);
	});

	it("estimates 1 for daily cron", () => {
		expect(estimateRunsPerDay("0 9 * * *")).toBe(1);
	});
});
