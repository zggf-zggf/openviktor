import type { PrismaClient } from "@openviktor/db";
import type { Logger } from "@openviktor/shared";
import { calculateNextRun } from "./cron-parser.js";

const CHANNEL_INTRO_SCHEDULE = "0 10 * * *";
const CHANNEL_INTRO_MAX_RUNS = 3;

interface WorkspaceRecord {
	id: string;
	settings: unknown;
}

export function buildOnboardingPrompt(userMessage: string): string {
	return `You are running the first-install onboarding for this workspace. Complete the following steps IN ORDER before responding to the user.

## Step 1 — Research the Company
Use \`quick_ai_search\` to research the company that owns this Slack workspace. Find their:
- Company name, product/service, and industry
- Key information that helps you understand their domain

## Step 2 — Enumerate the Team
Use \`coworker_list_slack_users\` to get all workspace members. For each real user (skip bots), note their:
- Display name and role (if visible)
- Whether they are the person who just messaged you

## Step 3 — Discover Channels
Use \`coworker_list_slack_channels\` to list all channels. Note each channel's name and purpose.

## Step 4 — Create Knowledge Skills
Create two skills using \`write_skill\`:

1. **Company skill** (name: "company", category: "company"):
   - Company name, product, industry
   - Key domain knowledge
   - Connected integrations (if any)

2. **Team skill** (name: "team", category: "team"):
   - Per-member profiles: name, role, communication notes
   - DM channel IDs (use \`coworker_open_slack_conversation\` if needed)

## Step 5 — Respond to the User
Now respond to the user's actual message. Send your response using \`coworker_send_slack_message\` to the originating channel and thread.

**Response design rules:**
- Reference their actual connected tools by name (proves immediate value)
- Include 2-3 copy-pasteable example requests scoped to their domain
- End with a trust-building statement, not a call to action
- Do NOT say "I am an AI assistant" — use peer framing ("Hey! I just got set up here...")
- Be warm but not sycophantic

## The User's Message
The user said: "${userMessage}"

## Important
- Call \`read_learnings\` first as always
- Call \`write_learning\` for any important observations about the team or company
- This is a one-time onboarding — make it count`;
}

export async function isOnboardingNeeded(
	prisma: PrismaClient,
	workspace: WorkspaceRecord,
): Promise<boolean> {
	const settings = workspace.settings as Record<string, unknown> | null;
	if (settings?.onboardingCompletedAt) return false;

	const runCount = await prisma.agentRun.count({
		where: { workspaceId: workspace.id },
		take: 1,
	});
	return runCount === 0;
}

export async function markOnboardingComplete(
	prisma: PrismaClient,
	workspace: WorkspaceRecord,
): Promise<void> {
	const existing = (workspace.settings as Record<string, unknown> | null) ?? {};
	await prisma.workspace.update({
		where: { id: workspace.id },
		data: {
			settings: { ...existing, onboardingCompletedAt: new Date().toISOString() },
		},
	});
}

export async function seedChannelIntros(
	prisma: PrismaClient,
	workspaceId: string,
	logger: Logger,
): Promise<void> {
	const existing = await prisma.cronJob.findFirst({
		where: { workspaceId, type: "CHANNEL_INTRO" },
	});
	if (existing) return;

	const now = new Date();
	const nextRunAt = calculateNextRun(CHANNEL_INTRO_SCHEDULE, now);

	await prisma.cronJob.create({
		data: {
			workspaceId,
			name: "Channel Introductions",
			schedule: CHANNEL_INTRO_SCHEDULE,
			description: "Introduce OpenViktor to workspace channels (self-deleting after 3 runs)",
			type: "CHANNEL_INTRO",
			costTier: 2,
			enabled: true,
			maxRuns: CHANNEL_INTRO_MAX_RUNS,
			agentPrompt: buildChannelIntroAgentPrompt(),
			nextRunAt,
		},
	});

	logger.info({ workspaceId }, "Seeded channel introduction cron");
}

function buildChannelIntroAgentPrompt(): string {
	return "Execute your channel introduction now. Follow the instructions in your system prompt.";
}
