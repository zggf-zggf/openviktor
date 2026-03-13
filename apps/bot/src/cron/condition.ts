import type { PrismaClient } from "@openviktor/db";
import type { Logger } from "@openviktor/shared";

const CONDITION_TIMEOUT_MS = 5_000;

export interface ConditionContext {
	workspaceId: string;
	cronJobId: string;
	lastRunAt: Date | null;
	prisma: PrismaClient;
	slackToken: string;
}

export interface ConditionHelpers {
	hasNewSlackMessages: (ctx: ConditionContext, opts?: { since?: Date }) => Promise<boolean>;
	isWithinBudget: (ctx: ConditionContext, opts: { maxMonthlyCents: number }) => Promise<boolean>;
	hasActiveThreads: (ctx: ConditionContext) => Promise<boolean>;
}

export const builtinHelpers: ConditionHelpers = {
	async hasNewSlackMessages(ctx, opts) {
		const since = opts?.since ?? ctx.lastRunAt ?? new Date(Date.now() - 3 * 60 * 60 * 1000);
		const recentMessages = await ctx.prisma.message.findFirst({
			where: {
				agentRun: { workspaceId: ctx.workspaceId },
				role: "user",
				createdAt: { gt: since },
			},
		});
		return recentMessages !== null;
	},

	async isWithinBudget(ctx, opts) {
		const startOfMonth = new Date();
		startOfMonth.setDate(1);
		startOfMonth.setHours(0, 0, 0, 0);

		const result = await ctx.prisma.agentRun.aggregate({
			where: {
				workspaceId: ctx.workspaceId,
				createdAt: { gte: startOfMonth },
				status: "COMPLETED",
			},
			_sum: { costCents: true },
		});
		const totalSpent = result._sum.costCents ?? 0;
		return totalSpent < opts.maxMonthlyCents;
	},

	async hasActiveThreads(ctx) {
		const activeThread = await ctx.prisma.thread.findFirst({
			where: {
				workspaceId: ctx.workspaceId,
				status: "ACTIVE",
			},
		});
		return activeThread !== null;
	},
};

export async function evaluateCondition(
	script: string,
	ctx: ConditionContext,
	logger: Logger,
): Promise<boolean> {
	try {
		const fn = new Function(
			"ctx",
			"helpers",
			`"use strict"; return (async () => { ${script} })();`,
		);

		const result = await Promise.race([
			fn(ctx, builtinHelpers),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Condition script timeout")), CONDITION_TIMEOUT_MS),
			),
		]);

		return Boolean(result);
	} catch (error) {
		logger.warn(
			{ cronJobId: ctx.cronJobId, err: error },
			"Condition script failed, defaulting to skip",
		);
		return false;
	}
}
