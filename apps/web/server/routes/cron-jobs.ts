import { prisma } from "@openviktor/db";
import { Hono } from "hono";

export const cronJobsRoutes = new Hono();

cronJobsRoutes.get("/cron-jobs", async (c) => {
	const jobs = await prisma.cronJob.findMany({
		orderBy: { createdAt: "desc" },
	});

	return c.json(
		jobs.map((j) => ({
			id: j.id,
			name: j.name,
			schedule: j.schedule,
			description: j.description,
			agentPrompt: j.agentPrompt,
			costTier: j.costTier,
			enabled: j.enabled,
			lastRunAt: j.lastRunAt?.toISOString() ?? null,
			nextRunAt: j.nextRunAt?.toISOString() ?? null,
			createdAt: j.createdAt.toISOString(),
		})),
	);
});

cronJobsRoutes.patch("/cron-jobs/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json<{ enabled?: boolean }>();

	if (typeof body.enabled !== "boolean") {
		return c.json({ error: "enabled must be a boolean" }, 400);
	}

	const job = await prisma.cronJob.update({
		where: { id },
		data: { enabled: body.enabled },
	});

	return c.json({
		id: job.id,
		name: job.name,
		schedule: job.schedule,
		description: job.description,
		agentPrompt: job.agentPrompt,
		costTier: job.costTier,
		enabled: job.enabled,
		lastRunAt: job.lastRunAt?.toISOString() ?? null,
		nextRunAt: job.nextRunAt?.toISOString() ?? null,
		createdAt: job.createdAt.toISOString(),
	});
});
