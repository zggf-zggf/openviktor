import { type Prisma, prisma } from "@openviktor/db";
import { Hono } from "hono";

export const knowledgeRoutes = new Hono();

knowledgeRoutes.get("/learnings", async (c) => {
	const page = Math.max(1, Number(c.req.query("page")) || 1);
	const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));
	const search = c.req.query("search");

	const where: Prisma.LearningWhereInput = {};
	if (search) {
		where.OR = [
			{ content: { contains: search, mode: "insensitive" } },
			{ source: { contains: search, mode: "insensitive" } },
			{ category: { contains: search, mode: "insensitive" } },
		];
	}

	const [data, total] = await Promise.all([
		prisma.learning.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: (page - 1) * limit,
			take: limit,
		}),
		prisma.learning.count({ where }),
	]);

	return c.json({
		data: data.map((l) => ({
			id: l.id,
			content: l.content,
			source: l.source,
			category: l.category,
			createdAt: l.createdAt.toISOString(),
		})),
		total,
		page,
		limit,
	});
});

knowledgeRoutes.get("/skills", async (c) => {
	const page = Math.max(1, Number(c.req.query("page")) || 1);
	const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));

	const [data, total] = await Promise.all([
		prisma.skill.findMany({
			orderBy: { updatedAt: "desc" },
			skip: (page - 1) * limit,
			take: limit,
		}),
		prisma.skill.count(),
	]);

	return c.json({
		data: data.map((s) => ({
			id: s.id,
			name: s.name,
			content: s.content,
			version: s.version,
			createdAt: s.createdAt.toISOString(),
			updatedAt: s.updatedAt.toISOString(),
		})),
		total,
		page,
		limit,
	});
});
