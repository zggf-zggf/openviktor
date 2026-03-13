import { prisma } from "@openviktor/db";
import { startOfDay, subDays } from "date-fns";
import { Hono } from "hono";

export const overviewRoutes = new Hono();

overviewRoutes.get("/overview", async (c) => {
	const now = new Date();
	const thirtyDaysAgo = subDays(now, 30);

	const [totalRuns, completedRuns, activeThreads, recentRunsRaw, last30dRuns] = await Promise.all([
		prisma.agentRun.count(),
		prisma.agentRun.count({ where: { status: "COMPLETED" } }),
		prisma.thread.count({ where: { status: "ACTIVE" } }),
		prisma.agentRun.findMany({
			orderBy: { createdAt: "desc" },
			take: 10,
			include: { member: { select: { displayName: true } } },
		}),
		prisma.agentRun.findMany({
			where: { createdAt: { gte: thirtyDaysAgo } },
			select: {
				createdAt: true,
				costCents: true,
				status: true,
				triggerType: true,
				model: true,
			},
		}),
	]);

	const totalCost = last30dRuns.reduce((sum, r) => sum + r.costCents, 0);
	const successRate = totalRuns > 0 ? (completedRuns / totalRuns) * 100 : 0;

	const byDay = new Map<string, { runs: number; cost: number }>();
	for (const run of last30dRuns) {
		const day = startOfDay(run.createdAt).toISOString().split("T")[0];
		const bucket = byDay.get(day) ?? { runs: 0, cost: 0 };
		bucket.runs++;
		bucket.cost += run.costCents;
		byDay.set(day, bucket);
	}
	const runsByDay = [...byDay.entries()]
		.map(([date, v]) => ({ date, ...v }))
		.sort((a, b) => a.date.localeCompare(b.date));

	const byModel = new Map<string, { cost: number; count: number }>();
	for (const run of last30dRuns) {
		const m = byModel.get(run.model) ?? { cost: 0, count: 0 };
		m.cost += run.costCents;
		m.count++;
		byModel.set(run.model, m);
	}
	const costByModel = [...byModel.entries()]
		.map(([model, v]) => ({ model, ...v }))
		.sort((a, b) => b.cost - a.cost);

	const byTrigger = new Map<string, number>();
	for (const run of last30dRuns) {
		byTrigger.set(run.triggerType, (byTrigger.get(run.triggerType) ?? 0) + 1);
	}
	const runsByTrigger = [...byTrigger.entries()]
		.map(([trigger, count]) => ({ trigger, count }))
		.sort((a, b) => b.count - a.count);

	const recentRuns = recentRunsRaw.map((r) => ({
		id: r.id,
		status: r.status,
		triggerType: r.triggerType,
		model: r.model,
		inputTokens: r.inputTokens,
		outputTokens: r.outputTokens,
		costCents: r.costCents,
		durationMs: r.durationMs,
		createdAt: r.createdAt.toISOString(),
		triggeredByName: r.member?.displayName ?? null,
	}));

	return c.json({
		stats: {
			totalRuns,
			totalCost,
			successRate: Math.round(successRate * 10) / 10,
			activeThreads,
		},
		runsByDay,
		costByModel,
		runsByTrigger,
		recentRuns,
	});
});
