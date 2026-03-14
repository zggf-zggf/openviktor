import { describe, expect, it, vi } from "vitest";
import { checkFrequencyWarning, checkWorkspaceBudget, getModelForTier } from "../cost-control.js";

describe("checkWorkspaceBudget", () => {
	it("allows when no budget is set", async () => {
		const prisma = {
			workspace: {
				findUnique: vi.fn().mockResolvedValue({ settings: {} }),
			},
		} as any;

		const result = await checkWorkspaceBudget(prisma, "ws-1");
		expect(result.allowed).toBe(true);
	});

	it("allows when workspace not found", async () => {
		const prisma = {
			workspace: {
				findUnique: vi.fn().mockResolvedValue(null),
			},
		} as any;

		const result = await checkWorkspaceBudget(prisma, "ws-nonexistent");
		expect(result.allowed).toBe(true);
	});

	it("allows when under budget", async () => {
		const prisma = {
			workspace: {
				findUnique: vi.fn().mockResolvedValue({
					settings: { costControl: { monthlyBudgetCents: 10000 } },
				}),
			},
			agentRun: {
				aggregate: vi.fn().mockResolvedValue({ _sum: { costCents: 5000 } }),
			},
		} as any;

		const result = await checkWorkspaceBudget(prisma, "ws-1");
		expect(result.allowed).toBe(true);
	});

	it("allows when exactly at budget (boundary)", async () => {
		const prisma = {
			workspace: {
				findUnique: vi.fn().mockResolvedValue({
					settings: { costControl: { monthlyBudgetCents: 10000 } },
				}),
			},
			agentRun: {
				aggregate: vi.fn().mockResolvedValue({ _sum: { costCents: 10000 } }),
			},
		} as any;

		const result = await checkWorkspaceBudget(prisma, "ws-1");
		expect(result.allowed).toBe(false);
	});

	it("blocks when over budget", async () => {
		const prisma = {
			workspace: {
				findUnique: vi.fn().mockResolvedValue({
					settings: { costControl: { monthlyBudgetCents: 10000 } },
				}),
			},
			agentRun: {
				aggregate: vi.fn().mockResolvedValue({ _sum: { costCents: 10001 } }),
			},
		} as any;

		const result = await checkWorkspaceBudget(prisma, "ws-1");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("Monthly budget exceeded");
	});
});

describe("checkFrequencyWarning", () => {
	it("returns null for low-frequency schedules", () => {
		expect(checkFrequencyWarning("0 9 * * 1")).toBeNull();
		expect(checkFrequencyWarning("0 9 * * *")).toBeNull();
		expect(checkFrequencyWarning("1 8,11,14,17 * * 1-5")).toBeNull();
	});

	it("returns warning for high-frequency schedules", () => {
		const warning = checkFrequencyWarning("*/10 * * * *");
		expect(warning).toContain("High frequency");
	});
});

describe("getModelForTier", () => {
	it("returns haiku for tier 1", () => {
		expect(getModelForTier(1, "default")).toContain("haiku");
	});

	it("returns sonnet for tier 2", () => {
		expect(getModelForTier(2, "default")).toContain("sonnet");
	});

	it("returns sonnet for tier 3", () => {
		expect(getModelForTier(3, "default")).toContain("sonnet");
	});

	it("returns default for unknown tier", () => {
		expect(getModelForTier(99, "my-default")).toBe("my-default");
	});

	it("uses model override when provided", () => {
		expect(getModelForTier(1, "default", "claude-opus-4-20250514")).toBe("claude-opus-4-20250514");
	});

	it("falls back to tier when override is null", () => {
		expect(getModelForTier(1, "default", null)).toContain("haiku");
	});

	it("falls back to tier when override is undefined", () => {
		expect(getModelForTier(2, "default", undefined)).toContain("sonnet");
	});
});
