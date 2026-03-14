import type { TriggerType } from "@openviktor/shared";

export interface ActiveThreadInfo {
	path: string;
	title: string | null;
	status: string;
}

export interface PromptContext {
	workspaceName: string;
	channel: string;
	slackThreadTs?: string;
	triggerType: TriggerType;
	userName?: string;
	skillCatalog?: string[];
	integrationCatalog?: string[];
	cronJobName?: string;
	cronAgentPrompt?: string;
	cronRunCount?: number;
	activeThreads?: ActiveThreadInfo[];
	threadId?: string;
	heartbeatPrompt?: string;
	discoveryPrompt?: string;
	threadPath?: string;
	onboardingPrompt?: string;
	channelIntroPrompt?: string;
}

function triggerLabel(triggerType: TriggerType): string {
	switch (triggerType) {
		case "MENTION":
			return "Channel mention";
		case "DM":
			return "Direct message";
		case "CRON":
			return "Scheduled cron job";
		case "HEARTBEAT":
			return "Heartbeat check-in";
		case "DISCOVERY":
			return "Discovery";
		case "ONBOARDING":
			return "First-install onboarding";
		case "MANUAL":
			return "Manual trigger";
		case "SPAWN":
			return "Spawned agent thread";
		default:
			return `Unknown (${triggerType})`;
	}
}

function buildSpecializedPrompt(name: string, prompt: string, preamble?: string): string {
	const lines = [`You are OpenViktor, an AI coworker in the "${name}" Slack workspace.`];
	if (preamble) lines.push(preamble);
	lines.push("", prompt);
	return lines.join("\n");
}

function resolveSpecializedPrompt(ctx: PromptContext): string | null {
	if (ctx.onboardingPrompt) {
		return buildSpecializedPrompt(
			ctx.workspaceName,
			ctx.onboardingPrompt,
			"This is your FIRST interaction with this workspace — make a great first impression.",
		);
	}
	if (ctx.channelIntroPrompt) {
		return buildSpecializedPrompt(ctx.workspaceName, ctx.channelIntroPrompt);
	}
	if (ctx.heartbeatPrompt) {
		return buildSpecializedPrompt(ctx.workspaceName, ctx.heartbeatPrompt);
	}
	if (ctx.discoveryPrompt) {
		return buildSpecializedPrompt(ctx.workspaceName, ctx.discoveryPrompt);
	}
	return null;
}

export function buildSystemPrompt(ctx: PromptContext): string {
	const specialized = resolveSpecializedPrompt(ctx);
	if (specialized) return specialized;

	if (ctx.triggerType === "CRON") {
		return buildCronPrompt(ctx);
	}

	return buildInteractivePrompt(ctx);
}

function buildCronPrompt(ctx: PromptContext): string {
	const lines = [
		`You are OpenViktor, an AI coworker in the "${ctx.workspaceName}" Slack workspace.`,
		`You are executing a scheduled cron job: "${ctx.cronJobName ?? "Unknown"}".`,
		"",
	];

	if (ctx.cronRunCount === 0) {
		lines.push(
			"IMPORTANT: This is the FIRST TIME this cron is running. Pay special attention to initial setup and baseline data collection.",
			"",
		);
	}

	lines.push(
		"## Guidelines",
		"- Execute the task described below thoroughly.",
		"- Use available tools to gather information and take action.",
		"- Post results to the appropriate Slack channel using coworker_send_slack_message.",
		"- Be concise and direct in any messages you send.",
		...buildErrorRules(),
	);

	if (ctx.cronAgentPrompt) {
		lines.push("", "## Task", ctx.cronAgentPrompt);
	}

	lines.push(...buildThreadInfoSection(ctx));
	lines.push(...buildActiveThreadsSection(ctx));

	return lines.join("\n");
}

function buildInteractivePrompt(ctx: PromptContext): string {
	const lines = [
		`You are OpenViktor, an AI coworker in the "${ctx.workspaceName}" Slack workspace.`,
		"You are helpful, knowledgeable, and concise. You communicate like a capable team member — clear, direct, and friendly.",
		"",
		"## Startup",
		"- **Always call `read_learnings` as your first action** to load accumulated knowledge before responding.",
		"- If you observe something worth remembering (team preferences, project patterns, corrections), call `write_learning` to persist it.",
		"",
		"## Guidelines",
		"- Be concise and direct. Avoid unnecessary filler.",
		"- Format responses using Markdown (**bold**, *italic*, `code`, ```code blocks```, [links](url)).",
		"- If you don't know something, say so honestly.",
		"- Match the energy of the conversation — casual for casual, detailed for technical.",
		...buildErrorRules(),
		"",
		"## Response Delivery",
		"- **Always send your response using `coworker_send_slack_message`** with the channel and thread_ts from your context.",
		"- You control when, where, and what to send. You can:",
		"  - Send multiple messages to different channels or threads",
		"  - Choose not to respond when no response is needed (e.g., just acknowledge with a reaction)",
		"  - Post top-level messages (omit thread_ts) for proactive outreach to channels",
		"  - Edit previously sent messages using `coworker_update_slack_message`",
		"- For reactive responses (replying to a DM or mention), always use the originating channel and thread_ts.",
		"",
		"## Reactions",
		"- Use `coworker_slack_react` to add emoji reactions to messages when appropriate:",
		"  - :eyes: — acknowledging something you've noticed or are reviewing",
		"  - :bulb: — sharing an insight or idea",
		"  - :tada: — celebrating achievements or good news",
		"",
		"## Permissions",
		"- Some tool calls may require user approval. When a tool requires permission, the system posts an Approve/Reject message.",
		"- Use `submit_permission_request` to check the status of a pending permission request before proceeding.",
		"",
		"## Current Context",
		`- Trigger: ${triggerLabel(ctx.triggerType)}`,
		`- Channel: ${ctx.channel}`,
	];

	if (ctx.slackThreadTs) {
		lines.push(`- Thread: ${ctx.slackThreadTs}`);
	}

	if (ctx.userName) {
		lines.push(`- User: ${ctx.userName}`);
	}

	lines.push(...buildSkillsSection(ctx));
	lines.push(...buildIntegrationsSection(ctx));
	lines.push(...buildThreadInfoSection(ctx, { skipTriggerAndChannel: true }));
	lines.push(...buildActiveThreadsSection(ctx));

	if (ctx.threadPath) {
		lines.push("");
		lines.push("## Your Thread Info");
		lines.push(`- Path: ${ctx.threadPath}`);
	}

	return lines.join("\n");
}

function buildErrorRules(): string[] {
	return [
		"- Own errors immediately — no blame on tools, APIs, or users.",
		"- When something fails, explain the root cause and offer a fix in the same message.",
		"- No defensive language or hedging.",
		"- Never fabricate URLs or data — leave blank instead.",
	];
}

function buildSkillsSection(ctx: PromptContext): string[] {
	if (!ctx.skillCatalog || ctx.skillCatalog.length === 0) return [];
	const lines = [
		"",
		"## Skills",
		"Use `read_skill` to load the full content of any skill.",
		'Skill descriptions follow the format: "[What it does]. Use when [trigger]. Do NOT use for [anti-trigger]."',
	];
	for (const entry of ctx.skillCatalog) {
		lines.push(`- ${entry}`);
	}
	return lines;
}

function buildIntegrationsSection(ctx: PromptContext): string[] {
	const lines = [
		"",
		"## Integrations",
		"You can connect to 3,000+ third-party services via Pipedream.",
		"- Use `list_available_integrations` to search for apps.",
		"- Use `connect_integration` to help users connect new apps.",
		"- Use `read_skill` to load full documentation for any connected integration.",
		"",
	];

	if (ctx.integrationCatalog && ctx.integrationCatalog.length > 0) {
		lines.push("Connected integrations:");
		for (const entry of ctx.integrationCatalog) {
			lines.push(`- ${entry}`);
		}
	} else {
		lines.push("Connected integrations: None yet — use `list_available_integrations` to explore.");
	}

	return lines;
}

function buildThreadInfoSection(
	ctx: PromptContext,
	options?: { skipTriggerAndChannel?: boolean },
): string[] {
	const lines: string[] = ["", "## Your Thread Info"];
	if (!options?.skipTriggerAndChannel) {
		lines.push(`- Trigger: ${triggerLabel(ctx.triggerType)}`);
	}
	if (ctx.threadId) {
		lines.push(`- Thread ID: ${ctx.threadId}`);
	}
	if (!options?.skipTriggerAndChannel && ctx.channel) {
		lines.push(`- Channel: ${ctx.channel}`);
	}
	if (ctx.cronJobName) {
		lines.push(`- Cron job: ${ctx.cronJobName}`);
	}
	return lines;
}

function buildActiveThreadsSection(ctx: PromptContext): string[] {
	if (!ctx.activeThreads || ctx.activeThreads.length === 0) return [];
	const lines: string[] = ["", "## Currently Active Threads"];
	for (const thread of ctx.activeThreads) {
		const label = thread.title ? `${thread.path} — ${thread.title}` : thread.path;
		lines.push(`- ${label} (${thread.status.toLowerCase()})`);
	}
	return lines;
}
