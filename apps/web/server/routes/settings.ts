import { prisma } from "@openviktor/db";
import { Hono } from "hono";

export const settingsRoutes = new Hono();

settingsRoutes.get("/settings", async (c) => {
	const workspaces = await prisma.workspace.findMany({
		include: {
			members: {
				select: { id: true, slackUserId: true, displayName: true },
				orderBy: { createdAt: "asc" },
			},
			_count: { select: { members: true } },
		},
		orderBy: { createdAt: "asc" },
	});

	return c.json(
		workspaces.map((w) => ({
			id: w.id,
			slackTeamId: w.slackTeamId,
			slackTeamName: w.slackTeamName,
			settings: w.settings,
			createdAt: w.createdAt.toISOString(),
			memberCount: w._count.members,
			members: w.members,
		})),
	);
});
