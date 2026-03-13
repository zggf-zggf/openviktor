import { type Prisma, prisma } from "@openviktor/db";
import { Hono } from "hono";

export const runsRoutes = new Hono();

runsRoutes.get("/runs", async (c) => {
	const page = Math.max(1, Number(c.req.query("page")) || 1);
	const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));
	const status = c.req.query("status");
	const triggerType = c.req.query("triggerType");
	const model = c.req.query("model");

	const where: Prisma.AgentRunWhereInput = {};
	if (status) where.status = status as Prisma.EnumRunStatusFilter;
	if (triggerType) where.triggerType = triggerType as Prisma.EnumTriggerTypeFilter;
	if (model) where.model = { contains: model };

	const [data, total] = await Promise.all([
		prisma.agentRun.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: (page - 1) * limit,
			take: limit,
			include: { member: { select: { displayName: true } } },
		}),
		prisma.agentRun.count({ where }),
	]);

	return c.json({
		data: data.map((r) => ({
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
		})),
		total,
		page,
		limit,
	});
});

runsRoutes.get("/runs/:id", async (c) => {
	const id = c.req.param("id");
	const run = await prisma.agentRun.findUnique({
		where: { id },
		include: {
			messages: { orderBy: { createdAt: "asc" } },
			toolCalls: { orderBy: { createdAt: "asc" } },
			thread: {
				select: {
					id: true,
					slackChannel: true,
					slackThreadTs: true,
					status: true,
				},
			},
			member: {
				select: { id: true, displayName: true, slackUserId: true },
			},
		},
	});

	if (!run) {
		return c.json({ error: "Run not found" }, 404);
	}

	return c.json({
		id: run.id,
		status: run.status,
		triggerType: run.triggerType,
		model: run.model,
		inputTokens: run.inputTokens,
		outputTokens: run.outputTokens,
		costCents: run.costCents,
		durationMs: run.durationMs,
		systemPrompt: run.systemPrompt,
		errorMessage: run.errorMessage,
		startedAt: run.startedAt?.toISOString() ?? null,
		completedAt: run.completedAt?.toISOString() ?? null,
		createdAt: run.createdAt.toISOString(),
		triggeredByName: run.member?.displayName ?? null,
		messages: run.messages.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
			tokenCount: m.tokenCount,
			createdAt: m.createdAt.toISOString(),
		})),
		toolCalls: run.toolCalls.map((tc) => ({
			id: tc.id,
			toolName: tc.toolName,
			toolType: tc.toolType,
			input: tc.input,
			output: tc.output,
			status: tc.status,
			durationMs: tc.durationMs,
			errorMessage: tc.errorMessage,
			createdAt: tc.createdAt.toISOString(),
		})),
		thread: run.thread,
	});
});
