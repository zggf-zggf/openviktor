import { prisma } from "@openviktor/db";
import { Hono } from "hono";

export const toolsRoutes = new Hono();

toolsRoutes.get("/tools/stats", async (c) => {
	const toolCalls = await prisma.toolCall.findMany({
		select: {
			toolName: true,
			status: true,
			durationMs: true,
			createdAt: true,
		},
	});

	const byTool = new Map<
		string,
		{
			totalCalls: number;
			successCount: number;
			failedCount: number;
			totalDuration: number;
			durationCount: number;
			lastUsed: Date | null;
		}
	>();

	for (const tc of toolCalls) {
		const stat = byTool.get(tc.toolName) ?? {
			totalCalls: 0,
			successCount: 0,
			failedCount: 0,
			totalDuration: 0,
			durationCount: 0,
			lastUsed: null,
		};
		stat.totalCalls++;
		if (tc.status === "COMPLETED") stat.successCount++;
		if (tc.status === "FAILED") stat.failedCount++;
		if (tc.durationMs !== null) {
			stat.totalDuration += tc.durationMs;
			stat.durationCount++;
		}
		if (!stat.lastUsed || tc.createdAt > stat.lastUsed) {
			stat.lastUsed = tc.createdAt;
		}
		byTool.set(tc.toolName, stat);
	}

	const stats = [...byTool.entries()]
		.map(([toolName, s]) => ({
			toolName,
			totalCalls: s.totalCalls,
			successCount: s.successCount,
			failedCount: s.failedCount,
			avgDurationMs: s.durationCount > 0 ? Math.round(s.totalDuration / s.durationCount) : 0,
			lastUsed: s.lastUsed?.toISOString() ?? null,
		}))
		.sort((a, b) => b.totalCalls - a.totalCalls);

	const totalCalls = toolCalls.length;
	const successCalls = toolCalls.filter((tc) => tc.status === "COMPLETED").length;

	return c.json({
		stats,
		totalCalls,
		overallSuccessRate: totalCalls > 0 ? Math.round((successCalls / totalCalls) * 1000) / 10 : 0,
	});
});
