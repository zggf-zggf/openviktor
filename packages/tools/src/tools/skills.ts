import type { PrismaClient } from "@openviktor/db";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";

export const readSkillDefinition: LLMToolDefinition = {
	name: "read_skill",
	description: "Read the full content of a skill by name.",
	input_schema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "The skill name to read",
			},
		},
		required: ["name"],
	},
};

export const listSkillsDefinition: LLMToolDefinition = {
	name: "list_skills",
	description: "List all skills available in this workspace with their names and descriptions.",
	input_schema: {
		type: "object",
		properties: {},
		required: [],
	},
};

export const writeSkillDefinition: LLMToolDefinition = {
	name: "write_skill",
	description:
		"Create or update a skill. If a skill with the same name exists, it will be updated and its version incremented.",
	input_schema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "The skill name (unique per workspace)",
			},
			description: {
				type: "string",
				description: "A one-liner description of the skill",
			},
			content: {
				type: "string",
				description: "The full skill content",
			},
		},
		required: ["name", "content"],
	},
};

export function createReadSkillExecutor(prisma: PrismaClient): ToolExecutor {
	return async (args, ctx) => {
		const name = args.name as string;
		if (!name || name.trim().length === 0) {
			return { output: null, durationMs: 0, error: "Skill name is required" };
		}

		const skill = await prisma.skill.findUnique({
			where: {
				workspaceId_name: {
					workspaceId: ctx.workspaceId,
					name: name.trim(),
				},
			},
		});

		if (!skill) {
			return { output: null, durationMs: 0, error: `Skill "${name}" not found` };
		}

		return {
			output: {
				name: skill.name,
				description: skill.description,
				content: skill.content,
				version: skill.version,
			},
			durationMs: 0,
		};
	};
}

export function createListSkillsExecutor(prisma: PrismaClient): ToolExecutor {
	return async (_args, ctx) => {
		const skills = await prisma.skill.findMany({
			where: { workspaceId: ctx.workspaceId },
			select: { name: true, description: true, version: true },
			orderBy: { name: "asc" },
		});

		if (skills.length === 0) {
			return {
				output: "No skills configured for this workspace yet.",
				durationMs: 0,
			};
		}

		const lines = skills.map((s) => {
			const desc = s.description ? ` — ${s.description}` : "";
			return `- **${s.name}** (v${s.version})${desc}`;
		});

		return {
			output: `# Skills (${skills.length})\n\n${lines.join("\n")}`,
			durationMs: 0,
		};
	};
}

export function createWriteSkillExecutor(prisma: PrismaClient): ToolExecutor {
	return async (args, ctx) => {
		const name = args.name as string;
		const content = args.content as string;
		const description = typeof args.description === "string" ? args.description : null;

		if (!name || name.trim().length === 0) {
			return { output: null, durationMs: 0, error: "Skill name is required" };
		}
		if (!content || content.trim().length === 0) {
			return { output: null, durationMs: 0, error: "Skill content is required" };
		}

		const existing = await prisma.skill.findUnique({
			where: {
				workspaceId_name: {
					workspaceId: ctx.workspaceId,
					name: name.trim(),
				},
			},
		});

		if (existing) {
			const updated = await prisma.skill.update({
				where: { id: existing.id },
				data: {
					content: content.trim(),
					description,
					version: existing.version + 1,
				},
			});
			return {
				output: { id: updated.id, name: updated.name, version: updated.version, updated: true },
				durationMs: 0,
			};
		}

		const created = await prisma.skill.create({
			data: {
				workspaceId: ctx.workspaceId,
				name: name.trim(),
				description,
				content: content.trim(),
			},
		});
		return {
			output: { id: created.id, name: created.name, version: created.version, created: true },
			durationMs: 0,
		};
	};
}
