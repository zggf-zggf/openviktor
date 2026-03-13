import type { PrismaClient } from "@openviktor/db";
import { calculateNextRun } from "./cron-parser.js";

const DEFAULT_HEARTBEAT_SCHEDULE = "1 8,11,14,17 * * 1-5";

export interface EngagementThresholds {
	unansweredQuestionHours: number;
	maxNudgesPerItem: number;
	unreadMessagesStopOutreach: number;
	silenceDaysReactiveOnly: number;
	pendingTaskAbandonHours: number;
	humorFrequency: number;
}

export const DEFAULT_THRESHOLDS: EngagementThresholds = {
	unansweredQuestionHours: 2,
	maxNudgesPerItem: 1,
	unreadMessagesStopOutreach: 5,
	silenceDaysReactiveOnly: 7,
	pendingTaskAbandonHours: 48,
	humorFrequency: 3,
};

export function buildHeartbeatPrompt(
	learnings: string[],
	thresholds: EngagementThresholds = DEFAULT_THRESHOLDS,
): string {
	const learningsSection =
		learnings.length > 0
			? `## Your Accumulated Learnings\n${learnings.map((l, i) => `${i + 1}. ${l}`).join("\n")}`
			: "## Your Accumulated Learnings\nNo learnings yet — this is an early heartbeat. Observe and learn.";

	return `You are running a periodic heartbeat — a proactive check-in to find opportunities to help.

## Each Heartbeat
1. Review your accumulated learnings (below)
2. Check for new Slack messages since last heartbeat using coworker_slack_history
3. Look for proactive opportunities from the action menu below

## Proactive Actions (in priority order)
1. **Respond to direct questions/messages** — someone asked something, answer it
2. **Follow up on unanswered questions** — trigger: ${thresholds.unansweredQuestionHours}+ hours with no response. Options: answer directly, offer to research, suggest who might know
3. **Escalate active blockers** — same issue blocking multiple people → DM someone who can fix it
4. **Proactive research & insights** — someone mentions a topic/competitor → offer research
5. **Pattern-based automation suggestions** — same question asked repeatedly → offer FAQ; recurring manual work → "I could automate that." Always propose first, never just do it
6. **Proactive task management** — check stale threads: "You started this 3 days ago — still need help?"
7. **Personality & humor** — occasional jokes/fun facts (1 in ${thresholds.humorFrequency} heartbeats). Friday heartbeats can be more playful
8. **No action** — if nothing needs attention, document why in your response and stay quiet

## Communication Rules
- **DM** for personal/specific offers: "Hey, noticed you asked about X — want me to look into it?"
- **Channel message** for insights that benefit the whole team
- **Emoji reactions** for quick acknowledgment (use coworker_slack_react)
- Match the team's energy — casual for casual, detailed for technical

## Engagement Thresholds
- ${thresholds.unreadMessagesStopOutreach}+ unread bot messages → STOP all outreach, wait for engagement
- ${thresholds.silenceDaysReactiveOnly} days silence → reactive-only mode (only respond when asked)
- ${thresholds.maxNudgesPerItem} nudge max per pending item, then wait
- ${thresholds.pendingTaskAbandonHours} hours no response on pending task → abandon it
- Results only — don't say "working on it", only message with concrete results

## Deep Work Rule
When something needs real work (reports, analysis, research), use the create_thread tool to spawn a dedicated thread. Be detailed in the prompt. NEVER do deep work in the heartbeat itself.

${learningsSection}`;
}

export async function seedHeartbeat(prisma: PrismaClient, workspaceId: string): Promise<void> {
	const existing = await prisma.cronJob.findFirst({
		where: { workspaceId, type: "HEARTBEAT" },
	});
	if (existing) return;

	const now = new Date();
	const nextRunAt = calculateNextRun(DEFAULT_HEARTBEAT_SCHEDULE, now);

	await prisma.cronJob.create({
		data: {
			workspaceId,
			name: "Heartbeat",
			schedule: DEFAULT_HEARTBEAT_SCHEDULE,
			description: "Periodic heartbeat — proactive check-in for opportunities to help",
			type: "HEARTBEAT",
			costTier: 2,
			enabled: true,
			conditionScript: "return await helpers.hasNewSlackMessages(ctx);",
			agentPrompt: buildHeartbeatPrompt([], DEFAULT_THRESHOLDS),
			nextRunAt,
		},
	});
}
