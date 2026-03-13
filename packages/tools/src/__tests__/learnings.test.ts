import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../registry.js";
import { createReadLearningsExecutor, createWriteLearningExecutor } from "../tools/learnings.js";

const ctx: ToolExecutionContext = {
	workspaceId: "ws_test",
	workspaceDir: "/tmp/test",
	timeoutMs: 30_000,
};

function makePrisma() {
	return {
		learning: {
			findMany: vi.fn(),
			create: vi.fn(),
		},
	};
}

describe("read_learnings", () => {
	let prisma: ReturnType<typeof makePrisma>;

	beforeEach(() => {
		prisma = makePrisma();
	});

	it("returns empty message when no learnings exist", async () => {
		prisma.learning.findMany.mockResolvedValue([]);
		const executor = createReadLearningsExecutor(prisma as never);

		const result = await executor({}, ctx);

		expect(result.output).toBe("No learnings found for this workspace yet.");
		expect(result.error).toBeUndefined();
		expect(prisma.learning.findMany).toHaveBeenCalledWith({
			where: { workspaceId: "ws_test" },
			orderBy: { createdAt: "desc" },
			take: 50,
		});
	});

	it("returns formatted learnings", async () => {
		prisma.learning.findMany.mockResolvedValue([
			{
				id: "l1",
				content: "Team prefers short updates",
				category: "preference",
				createdAt: new Date("2026-03-10"),
			},
			{
				id: "l2",
				content: "Deploy on Tuesdays",
				category: null,
				createdAt: new Date("2026-03-09"),
			},
		]);
		const executor = createReadLearningsExecutor(prisma as never);

		const result = await executor({}, ctx);

		expect(result.output).toContain("# Learnings (2 most recent)");
		expect(result.output).toContain("(2026-03-10 [preference]) Team prefers short updates");
		expect(result.output).toContain("(2026-03-09) Deploy on Tuesdays");
	});

	it("respects limit parameter", async () => {
		prisma.learning.findMany.mockResolvedValue([]);
		const executor = createReadLearningsExecutor(prisma as never);

		await executor({ limit: 10 }, ctx);

		expect(prisma.learning.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
	});

	it("caps limit at 200", async () => {
		prisma.learning.findMany.mockResolvedValue([]);
		const executor = createReadLearningsExecutor(prisma as never);

		await executor({ limit: 500 }, ctx);

		expect(prisma.learning.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
	});

	it("filters by category when provided", async () => {
		prisma.learning.findMany.mockResolvedValue([]);
		const executor = createReadLearningsExecutor(prisma as never);

		await executor({ category: "team" }, ctx);

		expect(prisma.learning.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { workspaceId: "ws_test", category: "team" },
			}),
		);
	});
});

describe("write_learning", () => {
	let prisma: ReturnType<typeof makePrisma>;

	beforeEach(() => {
		prisma = makePrisma();
	});

	it("creates a learning with content", async () => {
		prisma.learning.create.mockResolvedValue({ id: "l_new" });
		const executor = createWriteLearningExecutor(prisma as never);

		const result = await executor({ content: "New insight" }, ctx);

		expect(result.error).toBeUndefined();
		expect(result.output).toEqual({ id: "l_new", created: true });
		expect(prisma.learning.create).toHaveBeenCalledWith({
			data: {
				workspaceId: "ws_test",
				content: "New insight",
				source: "agent",
				category: null,
				agentRunId: null,
			},
		});
	});

	it("creates a learning with category and agent_run_id", async () => {
		prisma.learning.create.mockResolvedValue({ id: "l_new2" });
		const executor = createWriteLearningExecutor(prisma as never);

		const result = await executor(
			{ content: "Team rule", category: "team", agent_run_id: "run_123" },
			ctx,
		);

		expect(result.error).toBeUndefined();
		expect(prisma.learning.create).toHaveBeenCalledWith({
			data: {
				workspaceId: "ws_test",
				content: "Team rule",
				source: "agent_run:run_123",
				category: "team",
				agentRunId: "run_123",
			},
		});
	});

	it("rejects empty content", async () => {
		const executor = createWriteLearningExecutor(prisma as never);

		const result = await executor({ content: "" }, ctx);

		expect(result.error).toBe("Content is required");
		expect(prisma.learning.create).not.toHaveBeenCalled();
	});

	it("trims content whitespace", async () => {
		prisma.learning.create.mockResolvedValue({ id: "l_trim" });
		const executor = createWriteLearningExecutor(prisma as never);

		await executor({ content: "  trimmed  " }, ctx);

		expect(prisma.learning.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ content: "trimmed" }),
			}),
		);
	});
});
