import type { PrismaClient } from "@openviktor/db";
import type { Logger } from "@openviktor/shared";
import { estimateRunsPerDay } from "./cron-parser.js";

// Tier 1: cheap/fast for simple checks. Tier 2: standard for conditional work.
// Tier 3: same as tier 2 for now — upgrade to opus when cost-justified.
const DEFAULT_MODELS: Record<number, string> = {
	1: "claude-haiku-4-20250514",
	2: "claude-sonnet-4-20250514",
	3: "claude-sonnet-4-20250514",
};

const HIGH_FREQUENCY_THRESHOLD = 6;

export interface CostCheckResult {
	allowed: boolean;
	reason?: string;
}

export async function checkWorkspaceBudget(
	prisma: PrismaClient,
	workspaceId: string,
): Promise<CostCheckResult> {
	const workspace = await prisma.workspace.findUnique({
		where: { id: workspaceId },
		select: { settings: true },
	});

	const settings = workspace?.settings as Record<string, unknown> | null;
	const costControl = settings?.costControl as Record<string, unknown> | undefined;
	const monthlyBudgetCents = costControl?.monthlyBudgetCents as number | undefined;

	if (!monthlyBudgetCents) {
		return { allowed: true };
	}

	const startOfMonth = new Date();
	startOfMonth.setDate(1);
	startOfMonth.setHours(0, 0, 0, 0);

	const result = await prisma.agentRun.aggregate({
		where: {
			workspaceId,
			createdAt: { gte: startOfMonth },
			status: "COMPLETED",
		},
		_sum: { costCents: true },
	});

	const totalSpent = result._sum.costCents ?? 0;
	if (totalSpent >= monthlyBudgetCents) {
		return {
			allowed: false,
			reason: `Monthly budget exceeded: $${(totalSpent / 100).toFixed(2)} / $${(monthlyBudgetCents / 100).toFixed(2)}`,
		};
	}

	return { allowed: true };
}

export function checkFrequencyWarning(schedule: string): string | null {
	const runsPerDay = estimateRunsPerDay(schedule);
	if (runsPerDay > HIGH_FREQUENCY_THRESHOLD) {
		return `High frequency: ~${runsPerDay} runs/day. Consider adding a condition script to reduce costs.`;
	}
	return null;
}

export function getModelForTier(
	costTier: number,
	defaultModel: string,
	modelOverride?: string | null,
): string {
	if (modelOverride) return modelOverride;
	return DEFAULT_MODELS[costTier] ?? defaultModel;
}

export async function checkCostControl(
	prisma: PrismaClient,
	workspaceId: string,
	logger: Logger,
): Promise<CostCheckResult> {
	const budgetCheck = await checkWorkspaceBudget(prisma, workspaceId);
	if (!budgetCheck.allowed) {
		logger.warn({ workspaceId, reason: budgetCheck.reason }, "Cron run blocked by budget");
		return budgetCheck;
	}
	return { allowed: true };
}
