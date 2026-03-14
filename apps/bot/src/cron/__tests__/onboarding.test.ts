import { describe, expect, it, vi } from "vitest";
import {
	buildOnboardingPrompt,
	isOnboardingNeeded,
	markOnboardingComplete,
	seedChannelIntros,
} from "../onboarding.js";

describe("buildOnboardingPrompt", () => {
	it("includes all onboarding steps", () => {
		const prompt = buildOnboardingPrompt("hello");
		expect(prompt).toContain("Step 1 — Research the Company");
		expect(prompt).toContain("Step 2 — Enumerate the Team");
		expect(prompt).toContain("Step 3 — Discover Channels");
		expect(prompt).toContain("Step 4 — Create Knowledge Skills");
		expect(prompt).toContain("Step 5 — Respond to the User");
	});

	it("embeds the user message", () => {
		const prompt = buildOnboardingPrompt("what can you do?");
		expect(prompt).toContain("what can you do?");
	});

	it("references required tools", () => {
		const prompt = buildOnboardingPrompt("hi");
		expect(prompt).toContain("quick_ai_search");
		expect(prompt).toContain("coworker_list_slack_users");
		expect(prompt).toContain("coworker_list_slack_channels");
		expect(prompt).toContain("write_skill");
		expect(prompt).toContain("coworker_send_slack_message");
	});

	it("instructs peer framing (no AI self-intro)", () => {
		const prompt = buildOnboardingPrompt("hi");
		expect(prompt).toContain('Do NOT say "I am an AI assistant"');
		expect(prompt).toContain("peer framing");
	});

	it("creates company and team skills with categories", () => {
		const prompt = buildOnboardingPrompt("hi");
		expect(prompt).toContain('"company"');
		expect(prompt).toContain('"team"');
		expect(prompt).toContain("category");
	});
});

describe("isOnboardingNeeded", () => {
	it("returns true for fresh workspace with no runs", async () => {
		const prisma = {
			agentRun: { count: vi.fn().mockResolvedValue(0) },
		} as any;

		const workspace = { id: "ws-1", settings: {} };
		const result = await isOnboardingNeeded(prisma, workspace);
		expect(result).toBe(true);
	});

	it("returns false if onboardingCompletedAt is set", async () => {
		const prisma = {
			agentRun: { count: vi.fn() },
		} as any;

		const workspace = {
			id: "ws-1",
			settings: { onboardingCompletedAt: "2026-03-14T12:00:00Z" },
		};
		const result = await isOnboardingNeeded(prisma, workspace);
		expect(result).toBe(false);
		expect(prisma.agentRun.count).not.toHaveBeenCalled();
	});

	it("returns false if workspace has prior runs", async () => {
		const prisma = {
			agentRun: { count: vi.fn().mockResolvedValue(3) },
		} as any;

		const workspace = { id: "ws-1", settings: {} };
		const result = await isOnboardingNeeded(prisma, workspace);
		expect(result).toBe(false);
	});

	it("returns true when settings is null", async () => {
		const prisma = {
			agentRun: { count: vi.fn().mockResolvedValue(0) },
		} as any;

		const workspace = { id: "ws-1", settings: null };
		const result = await isOnboardingNeeded(prisma, workspace);
		expect(result).toBe(true);
	});
});

describe("markOnboardingComplete", () => {
	it("updates workspace settings with onboardingCompletedAt", async () => {
		const prisma = {
			workspace: { update: vi.fn().mockResolvedValue({}) },
		} as any;

		const workspace = { id: "ws-1", settings: { existingKey: "value" } };
		await markOnboardingComplete(prisma, workspace);

		expect(prisma.workspace.update).toHaveBeenCalledWith({
			where: { id: "ws-1" },
			data: {
				settings: expect.objectContaining({
					existingKey: "value",
					onboardingCompletedAt: expect.any(String),
				}),
			},
		});
	});

	it("handles null settings gracefully", async () => {
		const prisma = {
			workspace: { update: vi.fn().mockResolvedValue({}) },
		} as any;

		const workspace = { id: "ws-1", settings: null };
		await markOnboardingComplete(prisma, workspace);

		expect(prisma.workspace.update).toHaveBeenCalledWith({
			where: { id: "ws-1" },
			data: {
				settings: expect.objectContaining({
					onboardingCompletedAt: expect.any(String),
				}),
			},
		});
	});
});

describe("seedChannelIntros", () => {
	it("creates channel intro cron job for new workspace", async () => {
		const prisma = {
			cronJob: {
				findFirst: vi.fn().mockResolvedValue(null),
				create: vi.fn().mockResolvedValue({ id: "cron-1" }),
			},
		} as any;
		const logger = { info: vi.fn() } as any;

		await seedChannelIntros(prisma, "ws-1", logger);

		expect(prisma.cronJob.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				workspaceId: "ws-1",
				name: "Channel Introductions",
				type: "CHANNEL_INTRO",
				costTier: 2,
				enabled: true,
				maxRuns: 3,
			}),
		});
	});

	it("skips if channel intro cron already exists", async () => {
		const prisma = {
			cronJob: {
				findFirst: vi.fn().mockResolvedValue({ id: "existing" }),
				create: vi.fn(),
			},
		} as any;
		const logger = { info: vi.fn() } as any;

		await seedChannelIntros(prisma, "ws-1", logger);

		expect(prisma.cronJob.create).not.toHaveBeenCalled();
	});

	it("sets nextRunAt in the future", async () => {
		const prisma = {
			cronJob: {
				findFirst: vi.fn().mockResolvedValue(null),
				create: vi.fn().mockResolvedValue({ id: "cron-1" }),
			},
		} as any;
		const logger = { info: vi.fn() } as any;

		await seedChannelIntros(prisma, "ws-1", logger);

		const createCall = prisma.cronJob.create.mock.calls[0][0];
		expect(createCall.data.nextRunAt).toBeInstanceOf(Date);
		expect(createCall.data.nextRunAt.getTime()).toBeGreaterThan(Date.now());
	});
});
