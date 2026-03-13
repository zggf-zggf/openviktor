import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THRESHOLDS, buildHeartbeatPrompt, seedHeartbeat } from "../heartbeat.js";

describe("buildHeartbeatPrompt", () => {
	it("includes engagement thresholds", () => {
		const prompt = buildHeartbeatPrompt([]);
		expect(prompt).toContain("2+ hours");
		expect(prompt).toContain("5+ unread");
		expect(prompt).toContain("7 days");
		expect(prompt).toContain("48 hours");
		expect(prompt).toContain("1 nudge max");
	});

	it("includes learnings when provided", () => {
		const learnings = ["Team prefers brief messages", "Never fabricate URLs"];
		const prompt = buildHeartbeatPrompt(learnings);
		expect(prompt).toContain("Team prefers brief messages");
		expect(prompt).toContain("Never fabricate URLs");
		expect(prompt).toContain("1. Team prefers brief messages");
		expect(prompt).toContain("2. Never fabricate URLs");
	});

	it("shows empty learnings message for new workspaces", () => {
		const prompt = buildHeartbeatPrompt([]);
		expect(prompt).toContain("No learnings yet");
	});

	it("includes all proactive action categories", () => {
		const prompt = buildHeartbeatPrompt([]);
		expect(prompt).toContain("Follow up on unanswered questions");
		expect(prompt).toContain("Escalate active blockers");
		expect(prompt).toContain("Proactive research");
		expect(prompt).toContain("Pattern-based automation");
		expect(prompt).toContain("Proactive task management");
		expect(prompt).toContain("Personality & humor");
	});

	it("includes communication rules", () => {
		const prompt = buildHeartbeatPrompt([]);
		expect(prompt).toContain("DM");
		expect(prompt).toContain("Channel message");
		expect(prompt).toContain("Emoji reactions");
	});

	it("includes deep work rule", () => {
		const prompt = buildHeartbeatPrompt([]);
		expect(prompt).toContain("create_thread");
		expect(prompt).toContain("NEVER do deep work in the heartbeat");
	});

	it("uses custom thresholds when provided", () => {
		const customThresholds = { ...DEFAULT_THRESHOLDS, silenceDaysReactiveOnly: 14 };
		const prompt = buildHeartbeatPrompt([], customThresholds);
		expect(prompt).toContain("14 days silence");
	});
});

describe("seedHeartbeat", () => {
	it("creates heartbeat cron job for new workspace", async () => {
		const prisma = {
			cronJob: {
				findFirst: vi.fn().mockResolvedValue(null),
				create: vi.fn().mockResolvedValue({ id: "cron-1" }),
			},
		} as any;

		await seedHeartbeat(prisma, "ws-1");

		expect(prisma.cronJob.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				workspaceId: "ws-1",
				name: "Heartbeat",
				type: "HEARTBEAT",
				costTier: 2,
				enabled: true,
				schedule: "1 8,11,14,17 * * 1-5",
			}),
		});
	});

	it("skips if heartbeat already exists", async () => {
		const prisma = {
			cronJob: {
				findFirst: vi.fn().mockResolvedValue({ id: "existing" }),
				create: vi.fn(),
			},
		} as any;

		await seedHeartbeat(prisma, "ws-1");

		expect(prisma.cronJob.create).not.toHaveBeenCalled();
	});
});
