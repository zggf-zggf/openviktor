import { describe, expect, it, vi } from "vitest";
import { buildDiscoveryPrompt, seedDiscovery } from "../discovery.js";

describe("buildDiscoveryPrompt", () => {
	it("includes all 5 phases", () => {
		const prompt = buildDiscoveryPrompt([]);
		expect(prompt).toContain("Phase 1 — Data Gathering");
		expect(prompt).toContain("Phase 2 — Per-Person Profiling");
		expect(prompt).toContain("Phase 3 — Opportunity Identification");
		expect(prompt).toContain("Phase 4 — Engagement Decision");
		expect(prompt).toContain("Phase 5 — Execute & Document");
	});

	it("includes learnings when provided", () => {
		const learnings = ["Team communicates through code, not Slack", "Mateusz wants fast results"];
		const prompt = buildDiscoveryPrompt(learnings);
		expect(prompt).toContain("1. Team communicates through code, not Slack");
		expect(prompt).toContain("2. Mateusz wants fast results");
	});

	it("shows empty learnings message for first run", () => {
		const prompt = buildDiscoveryPrompt([]);
		expect(prompt).toContain("No learnings yet");
		expect(prompt).toContain("first discovery run");
	});

	it("includes engagement rules", () => {
		const prompt = buildDiscoveryPrompt([]);
		expect(prompt).toContain("8+ days");
		expect(prompt).toContain("STOP outreach");
		expect(prompt).toContain("coworker_get_slack_reactions");
	});

	it("includes proposal format guidance", () => {
		const prompt = buildDiscoveryPrompt([]);
		expect(prompt).toContain("2 proposals per person per run");
		expect(prompt).toContain("thread replies");
	});

	it("includes state file paths", () => {
		const prompt = buildDiscoveryPrompt([]);
		expect(prompt).toContain("crons/discovery/discovery.md");
		expect(prompt).toContain("crons/discovery/LEARNINGS.md");
	});

	it("includes conservative engagement strategy", () => {
		const prompt = buildDiscoveryPrompt([]);
		expect(prompt).toContain("Be the tool they reach for, not the colleague that keeps knocking");
		expect(prompt).toContain("restart outreach");
	});

	it("includes anti-patterns", () => {
		const prompt = buildDiscoveryPrompt([]);
		expect(prompt).toContain("Anti-Patterns");
		expect(prompt).toContain("Don't re-contact people who haven't responded");
	});

	it("includes opportunity categories", () => {
		const prompt = buildDiscoveryPrompt([]);
		expect(prompt).toContain("Research");
		expect(prompt).toContain("Writing");
		expect(prompt).toContain("Monitoring");
		expect(prompt).toContain("Data analysis");
		expect(prompt).toContain("Logistics");
	});

	it("includes tool references for available tools", () => {
		const prompt = buildDiscoveryPrompt([]);
		expect(prompt).toContain("file_read");
		expect(prompt).toContain("coworker_slack_history");
		expect(prompt).toContain("coworker_list_slack_users");
		expect(prompt).toContain("write_learning");
	});
});

describe("seedDiscovery", () => {
	it("creates discovery cron job for new workspace", async () => {
		const prisma = {
			cronJob: {
				findFirst: vi.fn().mockResolvedValue(null),
				create: vi.fn().mockResolvedValue({ id: "cron-1" }),
			},
		} as any;

		await seedDiscovery(prisma, "ws-1");

		expect(prisma.cronJob.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				workspaceId: "ws-1",
				name: "Workflow Discovery",
				type: "DISCOVERY",
				costTier: 2,
				enabled: true,
				schedule: "1 9 * * 2,5",
			}),
		});
	});

	it("skips if discovery already exists", async () => {
		const prisma = {
			cronJob: {
				findFirst: vi.fn().mockResolvedValue({ id: "existing" }),
				create: vi.fn(),
			},
		} as any;

		await seedDiscovery(prisma, "ws-1");

		expect(prisma.cronJob.create).not.toHaveBeenCalled();
	});

	it("sets correct condition script", async () => {
		const prisma = {
			cronJob: {
				findFirst: vi.fn().mockResolvedValue(null),
				create: vi.fn().mockResolvedValue({ id: "cron-1" }),
			},
		} as any;

		await seedDiscovery(prisma, "ws-1");

		expect(prisma.cronJob.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				conditionScript: "return await helpers.hasNewSlackMessages(ctx);",
			}),
		});
	});

	it("sets nextRunAt in the future", async () => {
		const prisma = {
			cronJob: {
				findFirst: vi.fn().mockResolvedValue(null),
				create: vi.fn().mockResolvedValue({ id: "cron-1" }),
			},
		} as any;

		await seedDiscovery(prisma, "ws-1");

		const createCall = prisma.cronJob.create.mock.calls[0][0];
		expect(createCall.data.nextRunAt).toBeInstanceOf(Date);
		expect(createCall.data.nextRunAt.getTime()).toBeGreaterThan(Date.now());
	});
});
