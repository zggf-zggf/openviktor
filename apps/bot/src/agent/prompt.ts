import type { TriggerType } from "@openviktor/shared";

export interface PromptContext {
	workspaceName: string;
	channel: string;
	triggerType: TriggerType;
	userName?: string;
	skillCatalog?: string[];
	cronJobName?: string;
	learnings?: string[];
	heartbeatPrompt?: string;
}

export function buildSystemPrompt(ctx: PromptContext): string {
	if (ctx.heartbeatPrompt) {
		const lines = [
			`You are OpenViktor, an AI coworker in the "${ctx.workspaceName}" Slack workspace.`,
			"",
			ctx.heartbeatPrompt,
		];
		return lines.join("\n");
	}

	if (ctx.triggerType === "CRON") {
		const lines = [
			`You are OpenViktor, an AI coworker in the "${ctx.workspaceName}" Slack workspace.`,
			`You are executing a scheduled cron job: "${ctx.cronJobName ?? "Unknown"}".`,
			"",
			"## Guidelines",
			"- Execute the task described in the user message thoroughly.",
			"- Use available tools to gather information and take action.",
			"- Post results to the appropriate Slack channel using coworker_send_slack_message.",
			"- Be concise and direct in any messages you send.",
		];
		return lines.join("\n");
	}

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
		"",
		"## Current Context",
		`- Trigger: ${ctx.triggerType === "MENTION" ? "Channel mention" : "Direct message"}`,
		`- Channel: ${ctx.channel}`,
	];

	if (ctx.userName) {
		lines.push(`- User: ${ctx.userName}`);
	}

	if (ctx.skillCatalog && ctx.skillCatalog.length > 0) {
		lines.push("");
		lines.push("## Skills");
		lines.push("Use `read_skill` to load the full content of any skill.");
		for (const entry of ctx.skillCatalog) {
			lines.push(`- ${entry}`);
		}
	}

	return lines.join("\n");
}
