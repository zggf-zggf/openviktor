import type { PrismaClient } from "@openviktor/db";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const readLearningsDefinition: LLMToolDefinition = {
	name: "read_learnings",
	description:
		"Read accumulated learnings for this workspace. Returns recent learnings as formatted markdown, ordered by most recent first. Call this at the start of every run to load context.",
	input_schema: {
		type: "object",
		properties: {
			limit: {
				type: "number",
				description: `Number of learnings to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT})`,
			},
			category: {
				type: "string",
				description: "Filter by category (optional)",
			},
		},
		required: [],
	},
};

export const writeLearningDefinition: LLMToolDefinition = {
	name: "write_learning",
	description:
		"Write a new learning to persist knowledge for future runs. Use this when you observe something worth remembering — behavioral rules, team preferences, project patterns, corrections, etc.",
	input_schema: {
		type: "object",
		properties: {
			content: {
				type: "string",
				description: "The learning content to persist",
			},
			category: {
				type: "string",
				description:
					"Optional category (e.g., 'team', 'process', 'technical', 'preference', 'correction')",
			},
		},
		required: ["content"],
	},
};

export function createReadLearningsExecutor(prisma: PrismaClient): ToolExecutor {
	return async (args, ctx) => {
		const limit = Math.min(
			typeof args.limit === "number" && args.limit > 0 ? args.limit : DEFAULT_LIMIT,
			MAX_LIMIT,
		);
		const category = typeof args.category === "string" ? args.category : undefined;

		const where: { workspaceId: string; category?: string } = {
			workspaceId: ctx.workspaceId,
		};
		if (category) {
			where.category = category;
		}

		const learnings = await prisma.learning.findMany({
			where,
			orderBy: { createdAt: "desc" },
			take: limit,
		});

		if (learnings.length === 0) {
			return {
				output: "No learnings found for this workspace yet.",
				durationMs: 0,
			};
		}

		const lines = learnings.map((l) => {
			const cat = l.category ? ` [${l.category}]` : "";
			const date = l.createdAt.toISOString().slice(0, 10);
			return `- (${date}${cat}) ${l.content}`;
		});

		const header = `# Learnings (${learnings.length} most recent)`;
		return {
			output: `${header}\n\n${lines.join("\n")}`,
			durationMs: 0,
		};
	};
}

export function createWriteLearningExecutor(prisma: PrismaClient): ToolExecutor {
	return async (args, ctx) => {
		const content = args.content as string;
		if (!content || content.trim().length === 0) {
			return { output: null, durationMs: 0, error: "Content is required" };
		}

		const agentRunId = typeof args.agent_run_id === "string" ? args.agent_run_id : undefined;

		const learning = await prisma.learning.create({
			data: {
				workspaceId: ctx.workspaceId,
				content: content.trim(),
				source: agentRunId ? `agent_run:${agentRunId}` : "agent",
				category: typeof args.category === "string" ? args.category : null,
				agentRunId: agentRunId ?? null,
			},
		});

		return {
			output: { id: learning.id, created: true },
			durationMs: 0,
		};
	};
}
