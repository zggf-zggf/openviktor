import { type Prisma, prisma } from "@openviktor/db";
import { Hono } from "hono";

export const threadsRoutes = new Hono();

threadsRoutes.get("/threads", async (c) => {
	const page = Math.max(1, Number(c.req.query("page")) || 1);
	const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));
	const status = c.req.query("status");

	const where: Prisma.ThreadWhereInput = {};
	if (status) where.status = status as Prisma.EnumThreadStatusFilter;

	const [threads, total] = await Promise.all([
		prisma.thread.findMany({
			where,
			orderBy: { updatedAt: "desc" },
			skip: (page - 1) * limit,
			take: limit,
			include: { _count: { select: { agentRuns: true } } },
		}),
		prisma.thread.count({ where }),
	]);

	return c.json({
		data: threads.map((t) => ({
			id: t.id,
			slackChannel: t.slackChannel,
			slackThreadTs: t.slackThreadTs,
			status: t.status,
			phase: t.phase,
			runCount: t._count.agentRuns,
			createdAt: t.createdAt.toISOString(),
			updatedAt: t.updatedAt.toISOString(),
		})),
		total,
		page,
		limit,
	});
});
