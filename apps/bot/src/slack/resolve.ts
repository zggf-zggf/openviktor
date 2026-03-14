import type { PrismaClient } from "@openviktor/db";

export interface SlackClient {
	team: { info: () => Promise<{ team?: { name?: string } }> };
	users: {
		info: (params: { user: string }) => Promise<{ user?: { real_name?: string; name?: string } }>;
	};
	conversations: {
		join: (params: { channel: string }) => Promise<unknown>;
	};
	reactions: {
		add: (params: { channel: string; timestamp: string; name: string }) => Promise<unknown>;
		remove: (params: { channel: string; timestamp: string; name: string }) => Promise<unknown>;
	};
}

export async function resolveWorkspace(
	prisma: PrismaClient,
	client: SlackClient,
	teamId: string,
	botToken: string,
	botUserId: string,
) {
	const existing = await prisma.workspace.findUnique({
		where: { slackTeamId: teamId },
	});
	if (existing) return existing;

	const teamInfo = await client.team.info();
	const teamName = teamInfo.team?.name ?? "Unknown";

	return prisma.workspace.create({
		data: {
			slackTeamId: teamId,
			slackTeamName: teamName,
			slackBotToken: botToken,
			slackBotUserId: botUserId,
		},
	});
}

export async function resolveMember(
	prisma: PrismaClient,
	client: SlackClient,
	workspaceId: string,
	slackUserId: string,
) {
	const existing = await prisma.member.findUnique({
		where: { workspaceId_slackUserId: { workspaceId, slackUserId } },
	});
	if (existing) return existing;

	const userInfo = await client.users.info({ user: slackUserId });
	const displayName = userInfo.user?.real_name ?? userInfo.user?.name ?? null;

	return prisma.member.create({
		data: {
			workspaceId,
			slackUserId,
			displayName,
		},
	});
}

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripBotMention(text: string, botUserId: string): string {
	return text.replace(new RegExp(`<@${escapeRegExp(botUserId)}(\\|[^>]*)?>\\s*`, "g"), "").trim();
}
