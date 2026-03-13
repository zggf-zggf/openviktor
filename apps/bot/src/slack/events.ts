import type { PrismaClient } from "@openviktor/db";
import { type Logger, chunkMessage, markdownToMrkdwn } from "@openviktor/shared";
import type { App } from "@slack/bolt";
import type { AgentRunner } from "../agent/runner.js";
import { type SlackClient, resolveMember, resolveWorkspace } from "./resolve.js";

export interface BotContext {
	prisma: PrismaClient;
	runner: AgentRunner;
	logger: Logger;
}

interface SlackMessage {
	channel: string;
	channel_type?: string;
	user?: string;
	text?: string;
	thread_ts?: string;
	ts: string;
	subtype?: string;
	bot_id?: string;
}

async function resolveContext(
	ctx: BotContext,
	client: unknown,
	teamId: string,
	botToken: string,
	botUserId: string,
	slackUserId: string,
) {
	const slackClient = client as unknown as SlackClient;
	const workspace = await resolveWorkspace(ctx.prisma, slackClient, teamId, botToken, botUserId);
	const member = await resolveMember(ctx.prisma, slackClient, workspace.id, slackUserId);
	return { workspace, member };
}

async function fetchSkillCatalog(prisma: PrismaClient, workspaceId: string): Promise<string[]> {
	const skills = await prisma.skill.findMany({
		where: { workspaceId },
		select: { name: true, description: true, version: true },
		orderBy: { name: "asc" },
	});
	return skills.map((s) => {
		const desc = s.description ? ` — ${s.description}` : "";
		return `${s.name} (v${s.version})${desc}`;
	});
}

async function isBotInThread(
	prisma: PrismaClient,
	teamId: string,
	channel: string,
	threadTs: string,
): Promise<boolean> {
	const existing = await prisma.thread.findFirst({
		where: {
			workspace: { slackTeamId: teamId },
			slackChannel: channel,
			slackThreadTs: threadTs,
		},
	});
	return existing !== null;
}

async function handleMessage(
	ctx: BotContext,
	msg: SlackMessage,
	client: unknown,
	teamId: string,
	botToken: string,
	botUserId: string,
	say: (opts: { text: string; thread_ts?: string }) => Promise<unknown>,
): Promise<void> {
	const isDm = msg.channel_type === "im";
	const threadTs = msg.thread_ts ?? msg.ts;

	if (!isDm && msg.thread_ts) {
		const participating = await isBotInThread(ctx.prisma, teamId, msg.channel, msg.thread_ts);
		if (!participating) return;
	}

	const { workspace, member } = await resolveContext(
		ctx,
		client,
		teamId,
		botToken,
		botUserId,
		msg.user as string,
	);

	const triggerType = isDm ? "DM" : "MENTION";

	const skillCatalog = await fetchSkillCatalog(ctx.prisma, workspace.id);

	const result = await ctx.runner.run({
		workspaceId: workspace.id,
		memberId: member.id,
		triggerType,
		slackChannel: msg.channel,
		slackThreadTs: threadTs,
		userMessage: msg.text as string,
		promptContext: {
			workspaceName: workspace.slackTeamName,
			channel: msg.channel,
			triggerType,
			userName: member.displayName ?? undefined,
			skillCatalog,
		},
	});

	await sendResponse(say, result.responseText, threadTs);
}

async function sendResponse(
	say: (opts: { text: string; thread_ts?: string }) => Promise<unknown>,
	responseText: string,
	threadTs: string,
): Promise<void> {
	const mrkdwn = markdownToMrkdwn(responseText);
	const chunks = chunkMessage(mrkdwn);
	for (const chunk of chunks) {
		await say({ text: chunk, thread_ts: threadTs });
	}
}

async function safeReply(
	say: (opts: { text: string; thread_ts?: string }) => Promise<unknown>,
	threadTs?: string,
): Promise<void> {
	try {
		await say({
			text: "Sorry, I ran into an error processing your request. Please try again.",
			thread_ts: threadTs,
		});
	} catch {
		// Best-effort error reply
	}
}

export function registerEventHandlers(app: App, ctx: BotContext): void {
	app.event("app_mention", async ({ event, say, context, client }) => {
		const threadTs = event.thread_ts ?? event.ts;

		try {
			const teamId = context.teamId;
			const botUserId = context.botUserId;
			const botToken = context.botToken;
			const slackUser = event.user;
			const rawText = event.text;
			if (!teamId || !botUserId || !botToken || !slackUser || !rawText) {
				ctx.logger.error("Missing required fields in app_mention event or context");
				return;
			}

			const slackClient = client as unknown as SlackClient;
			try {
				await slackClient.conversations.join({ channel: event.channel });
			} catch {
				// Already a member or can't join — continue regardless
			}

			const { workspace, member } = await resolveContext(
				ctx,
				client,
				teamId,
				botToken,
				botUserId,
				slackUser,
			);

			const skills = await ctx.prisma.skill.findMany({
				where: { workspaceId: workspace.id },
				select: { name: true, description: true, version: true },
				orderBy: { name: "asc" },
			});
			const skillCatalog = skills.map((s) => {
				const desc = s.description ? ` — ${s.description}` : "";
				return `${s.name} (v${s.version})${desc}`;
			});

			const result = await ctx.runner.run({
				workspaceId: workspace.id,
				memberId: member.id,
				triggerType: "MENTION",
				slackChannel: event.channel,
				slackThreadTs: threadTs,
				userMessage: rawText,
				promptContext: {
					workspaceName: workspace.slackTeamName,
					channel: event.channel,
					triggerType: "MENTION",
					userName: member.displayName ?? undefined,
					skillCatalog,
				},
			});

			await sendResponse(say, result.responseText, threadTs);
		} catch (error) {
			ctx.logger.error({ err: error, event: "app_mention" }, "Failed to handle mention");
			await safeReply(say, threadTs);
		}
	});

	app.event("message", async ({ event, say, context, client }) => {
		const msg = event as unknown as SlackMessage;
		const { teamId, botUserId, botToken } = context;

		const isActionable =
			!msg.subtype && !msg.bot_id && msg.user && msg.text && msg.user !== botUserId;
		if (!isActionable) return;

		const isDm = msg.channel_type === "im";
		if (!isDm && !msg.thread_ts) return;

		if (!teamId || !botUserId || !botToken) {
			ctx.logger.error("Missing teamId, botUserId, or botToken in context");
			return;
		}

		try {
			await handleMessage(ctx, msg, client, teamId, botToken, botUserId, say);
		} catch (error) {
			const eventName = isDm ? "message_im" : "message_thread";
			ctx.logger.error({ err: error, event: eventName }, "Failed to handle message");
			await safeReply(say, msg.thread_ts);
		}
	});
}
