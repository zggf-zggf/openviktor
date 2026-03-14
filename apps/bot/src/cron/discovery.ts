import type { PrismaClient } from "@openviktor/db";
import { calculateNextRun } from "./cron-parser.js";

const DEFAULT_DISCOVERY_SCHEDULE = "1 9 * * 2,5";

export function buildDiscoveryPrompt(learnings: string[]): string {
	const learningsSection =
		learnings.length > 0
			? `## Your Accumulated Learnings\n${learnings.map((l, i) => `${i + 1}. ${l}`).join("\n")}`
			: "## Your Accumulated Learnings\nNo learnings yet — this is your first discovery run. Observe everything and document thoroughly.";

	return `You are running a workflow discovery — a strategic per-person profiling to find meaningful ways you can help the team.

## Before You Start
1. Read \`crons/discovery/discovery.md\` using file_read — your running progress tracker. If it doesn't exist, create it.
2. Read \`crons/discovery/LEARNINGS.md\` using file_read — accumulated discovery learnings. If it doesn't exist, create it.
3. Call \`read_learnings\` to load your general accumulated knowledge.
4. Call \`coworker_list_slack_users\` to get the current team roster.

## Phase 1 — Data Gathering
For each team member:
1. Check their Slack message history using \`coworker_slack_history\` — read extensively, not just 1-2 searches
2. Check their recent activity patterns — what channels are they active in?
3. What do they spend time on? What do they complain about? What recurring tasks do they mention?

## Phase 2 — Per-Person Profiling
For each team member, document in \`discovery.md\`:
- Their role and responsibilities
- Communication style
- Current focus areas
- Pain points observed (with evidence from Slack)
- Prior interactions with you (check your DM history with them)
- Their DM channel ID (use \`coworker_open_slack_conversation\` if needed)

## Phase 3 — Opportunity Identification
Scan for tasks where you have comparative advantage:
- **Research** — competitor analysis, market research, technical deep-dives
- **Writing** — reports, documentation, summaries, copy
- **Monitoring** — tracking metrics, alerting on anomalies, watching for events
- **Data analysis** — processing spreadsheets, aggregating data, finding patterns
- **Logistics** — event planning, scheduling, coordination tasks

For each opportunity:
- Tag as "proposed" (will DM about it) or "tracked, not pitched" (noted but not offering yet)
- Max **2 proposals per person per run** — don't overwhelm
- Think through implementation: would this be a cron job, on-demand skill, or one-off task?

## Phase 4 — Engagement Decision
**Check engagement on past proposals:**
- Use \`coworker_get_slack_reactions\` to check reactions on messages you've sent
- Check your DM history for replies

**Engagement rules:**
- If you've never contacted someone → eligible for first outreach (select 2-3 people per run)
- If zero engagement for 8+ days AND zero emoji reactions AND proposed tasks completed independently → **STOP outreach** for that person
- If someone has engaged (any reaction, reply, or @mention) → continue offering help
- Skip inactive members (no Slack or Linear activity for 2+ weeks)

**When to STOP all outreach (all must be true):**
1. Zero Slack engagement for 8+ days
2. Zero emoji reactions on any message
3. At least one proposed task completed independently
4. Clear signal the team prefers less proactive contact

**Post-stop rules:**
- Do NOT send more proposal DMs
- Do NOT post channel proposals
- Continue weekly digest as ONE proactive touch (if a digest cron exists)
- Respond instantly if anyone @mentions or DMs
- Track opportunities but don't pitch unprompted

**Conditions that restart outreach:**
1. Any human Slack message directed at you — even a reaction emoji
2. Someone @mentioning you
3. New team member joins the workspace
4. Previously inactive member returns
5. Someone DMs you directly

## Phase 5 — Execute & Document
**If outreach is warranted:**

DM proposal format — keep the DM short, put details in thread replies:

**DM message (short, scannable):**
> Hey [name]! I've been getting up to speed on the team's work. I noticed you [observation].
>
> A couple things I could help with:
> • [One-sentence summary of proposal 1]
> • [One-sentence summary of proposal 2]
>
> Full details in the thread — or just tell me what you need!

**Thread replies (one per proposal):**
1. What I observed — the pain point or opportunity
2. What I'd do — clear description of the workflow
3. How it would work — cron job, on-demand, one-off
4. What you'd get — the output/benefit

**Always update state files:**
- Update \`crons/discovery/discovery.md\` with: who was profiled, proposals made, engagement status, strategic decisions
- Update \`crons/discovery/LEARNINGS.md\` with: process learnings, team insights, what worked/didn't
- Call \`write_learning\` for important persistent insights

## Communication Rules
- **DM** for personal workflow proposals
- **Never spam** — if someone hasn't responded, don't send more messages
- **Be the tool they reach for, not the colleague that keeps knocking**
- Match the team's energy — casual for casual, detailed for technical
- Results only — don't say "working on it", only message with concrete proposals

## Anti-Patterns
- Don't propose vague "I could help with X" — think through implementation
- Don't only propose reports/summaries — you can do REAL WORK (process data, make decisions, take actions)
- Don't re-contact people who haven't responded
- Don't do shallow investigation (1-2 Slack searches per person is not enough)
- Don't conflate "active on Linear" with "interested in you" — they can be productive without needing AI help

${learningsSection}`;
}

export async function seedDiscovery(prisma: PrismaClient, workspaceId: string): Promise<void> {
	const existing = await prisma.cronJob.findFirst({
		where: { workspaceId, type: "DISCOVERY" },
	});
	if (existing) return;

	const now = new Date();
	const nextRunAt = calculateNextRun(DEFAULT_DISCOVERY_SCHEDULE, now);

	await prisma.cronJob.create({
		data: {
			workspaceId,
			name: "Workflow Discovery",
			schedule: DEFAULT_DISCOVERY_SCHEDULE,
			description: "Per-person profiling and personalized workflow proposals",
			type: "DISCOVERY",
			costTier: 2,
			enabled: true,
			conditionScript: "return await helpers.hasNewSlackMessages(ctx);",
			agentPrompt: buildDiscoveryPrompt([]),
			nextRunAt,
		},
	});
}
