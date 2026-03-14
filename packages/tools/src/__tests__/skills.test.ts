import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../registry.js";
import {
	createListSkillsExecutor,
	createReadSkillExecutor,
	createWriteSkillExecutor,
} from "../tools/skills.js";

const ctx: ToolExecutionContext = {
	workspaceId: "ws_test",
	workspaceDir: "/tmp/test",
	timeoutMs: 30_000,
};

function makePrisma() {
	return {
		skill: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
			upsert: vi.fn(),
		},
	};
}

describe("read_skill", () => {
	let prisma: ReturnType<typeof makePrisma>;

	beforeEach(() => {
		prisma = makePrisma();
	});

	it("returns skill content when found", async () => {
		prisma.skill.findUnique.mockResolvedValue({
			name: "team",
			description: "Team profiles",
			content: "# Team\n- Alice: Engineer",
			version: 2,
		});
		const executor = createReadSkillExecutor(prisma as never);

		const result = await executor({ name: "team" }, ctx);

		expect(result.error).toBeUndefined();
		expect(result.output).toEqual({
			name: "team",
			description: "Team profiles",
			content: "# Team\n- Alice: Engineer",
			version: 2,
		});
		expect(prisma.skill.findUnique).toHaveBeenCalledWith({
			where: { workspaceId_name: { workspaceId: "ws_test", name: "team" } },
		});
	});

	it("returns error when skill not found", async () => {
		prisma.skill.findUnique.mockResolvedValue(null);
		const executor = createReadSkillExecutor(prisma as never);

		const result = await executor({ name: "missing" }, ctx);

		expect(result.error).toBe('Skill "missing" not found');
	});

	it("rejects empty name", async () => {
		const executor = createReadSkillExecutor(prisma as never);

		const result = await executor({ name: "" }, ctx);

		expect(result.error).toBe("Skill name is required");
	});

	it("rejects non-string name", async () => {
		const executor = createReadSkillExecutor(prisma as never);

		const result = await executor({ name: 123 }, ctx);

		expect(result.error).toBe("Skill name is required");
	});
});

describe("list_skills", () => {
	let prisma: ReturnType<typeof makePrisma>;

	beforeEach(() => {
		prisma = makePrisma();
	});

	it("returns empty message when no skills exist", async () => {
		prisma.skill.findMany.mockResolvedValue([]);
		const executor = createListSkillsExecutor(prisma as never);

		const result = await executor({}, ctx);

		expect(result.output).toBe("No skills configured for this workspace yet.");
	});

	it("returns formatted skill list", async () => {
		prisma.skill.findMany.mockResolvedValue([
			{ name: "company", description: "Company context", version: 1 },
			{ name: "team", description: null, version: 3 },
		]);
		const executor = createListSkillsExecutor(prisma as never);

		const result = await executor({}, ctx);

		expect(result.output).toContain("# Skills (2)");
		expect(result.output).toContain("**company** (v1) — Company context");
		expect(result.output).toContain("**team** (v3)");
		expect(result.output).not.toContain("**team** (v3) —");
	});
});

describe("write_skill", () => {
	let prisma: ReturnType<typeof makePrisma>;

	beforeEach(() => {
		prisma = makePrisma();
	});

	it("creates a new skill via upsert", async () => {
		prisma.skill.upsert.mockResolvedValue({
			id: "sk_new",
			name: "team",
			version: 1,
		});
		const executor = createWriteSkillExecutor(prisma as never);

		const result = await executor(
			{ name: "team", description: "Team profiles", content: "# Team" },
			ctx,
		);

		expect(result.error).toBeUndefined();
		expect(result.output).toEqual({ id: "sk_new", name: "team", version: 1, created: true });
		expect(prisma.skill.upsert).toHaveBeenCalledWith({
			where: { workspaceId_name: { workspaceId: "ws_test", name: "team" } },
			update: {
				content: "# Team",
				description: "Team profiles",
				version: { increment: 1 },
			},
			create: {
				workspaceId: "ws_test",
				name: "team",
				description: "Team profiles",
				content: "# Team",
				category: null,
			},
		});
	});

	it("updates existing skill and increments version via upsert", async () => {
		prisma.skill.upsert.mockResolvedValue({
			id: "sk_existing",
			name: "team",
			version: 3,
		});
		const executor = createWriteSkillExecutor(prisma as never);

		const result = await executor({ name: "team", content: "# Updated Team" }, ctx);

		expect(result.error).toBeUndefined();
		expect(result.output).toEqual({
			id: "sk_existing",
			name: "team",
			version: 3,
			updated: true,
		});
	});

	it("rejects empty name", async () => {
		const executor = createWriteSkillExecutor(prisma as never);

		const result = await executor({ name: "", content: "x" }, ctx);

		expect(result.error).toBe("Skill name is required");
	});

	it("rejects non-string name", async () => {
		const executor = createWriteSkillExecutor(prisma as never);

		const result = await executor({ name: 42, content: "x" }, ctx);

		expect(result.error).toBe("Skill name is required");
	});

	it("rejects empty content", async () => {
		const executor = createWriteSkillExecutor(prisma as never);

		const result = await executor({ name: "team", content: "  " }, ctx);

		expect(result.error).toBe("Skill content is required");
	});

	it("rejects non-string content", async () => {
		const executor = createWriteSkillExecutor(prisma as never);

		const result = await executor({ name: "team", content: 123 }, ctx);

		expect(result.error).toBe("Skill content is required");
	});
});
