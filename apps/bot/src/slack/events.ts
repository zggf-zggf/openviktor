import type { PrismaClient } from "@openviktor/db";
import type { Logger } from "@openviktor/shared";
import type { App } from "@slack/bolt";
import type { AgentRunner } from "../agent/runner.js";
import { type SlackClient, resolveMember, resolveWorkspace } from "./resolve.js";

export interface BotContext {
	prisma: PrismaClient;
	runner: AgentRunner;
	logger: Logger;
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

			const { workspace, member } = await resolveContext(
				ctx,
				client,
				teamId,
				botToken,
				botUserId,
				slackUser,
			);
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
				},
			});

			await say({ text: result.responseText, thread_ts: threadTs });
		} catch (error) {
			ctx.logger.error({ err: error, event: "app_mention" }, "Failed to handle mention");
			try {
				await say({
					text: "Sorry, I ran into an error processing your request. Please try again.",
					thread_ts: threadTs,
				});
			} catch {
				// Best-effort error reply
			}
		}
	});

	app.event("message", async ({ event, say, context, client }) => {
		const msg = event as typeof event & {
			channel_type?: string;
			user?: string;
			text?: string;
			thread_ts?: string;
		};
		if (msg.channel_type !== "im" || !msg.user || !msg.text) return;

		try {
			const teamId = context.teamId;
			const botUserId = context.botUserId;
			const botToken = context.botToken;
			if (!teamId || !botUserId || !botToken) {
				ctx.logger.error("Missing teamId, botUserId, or botToken in context");
				return;
			}

			const { workspace, member } = await resolveContext(
				ctx,
				client,
				teamId,
				botToken,
				botUserId,
				msg.user,
			);

			const threadTs = msg.thread_ts ?? msg.ts;

			const result = await ctx.runner.run({
				workspaceId: workspace.id,
				memberId: member.id,
				triggerType: "DM",
				slackChannel: msg.channel,
				slackThreadTs: threadTs,
				userMessage: msg.text,
				promptContext: {
					workspaceName: workspace.slackTeamName,
					channel: msg.channel,
					triggerType: "DM",
					userName: member.displayName ?? undefined,
				},
			});

			const sayOptions: { text: string; thread_ts?: string } = {
				text: result.responseText,
			};
			if (msg.thread_ts) {
				sayOptions.thread_ts = msg.thread_ts;
			}
			await say(sayOptions);
		} catch (error) {
			ctx.logger.error({ err: error, event: "message_im" }, "Failed to handle DM");
			try {
				await say({
					text: "Sorry, I ran into an error processing your request. Please try again.",
				});
			} catch {
				// Best-effort error reply
			}
		}
	});
}
