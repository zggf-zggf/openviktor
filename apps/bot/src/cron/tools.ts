import type { PrismaClient } from "@openviktor/db";
import type { LLMToolDefinition, ToolResult } from "@openviktor/shared";
import type { ToolExecutionContext, ToolExecutor } from "@openviktor/tools";
import { checkFrequencyWarning } from "./cost-control.js";
import { calculateNextRun, estimateRunsPerDay, isValidCronExpression } from "./cron-parser.js";
import type { CronScheduler } from "./scheduler.js";

// ─── Tool Definitions ──────────────────────────────────

export const createCronJobDefinition: LLMToolDefinition = {
	name: "create_cron_job",
	description:
		"Create a scheduled cron job that runs an AI agent on a POSIX cron schedule. The agent will execute the given prompt at each scheduled time. Use condition scripts to reduce costs.",
	input_schema: {
		type: "object",
		properties: {
			name: { type: "string", description: "Short display name for the cron job" },
			schedule: {
				type: "string",
				description: "POSIX 5-field cron expression (e.g. '0 9 * * 1' for Monday 9am)",
			},
			description: { type: "string", description: "Task prompt/instructions executed on each run" },
			agent_prompt: { type: "string", description: "Full agent prompt for each execution" },
			cost_tier: {
				type: "number",
				description: "Cost tier 1-3 (1=cheap/haiku, 2=standard/sonnet, 3=full/opus). Default: 1",
			},
			condition_script: {
				type: "string",
				description:
					"TypeScript condition body. Return true to run, false to skip. Has access to ctx and helpers (hasNewSlackMessages, isWithinBudget, hasActiveThreads).",
			},
			slack_channel: {
				type: "string",
				description:
					"Slack channel ID for output. Defaults to the channel where this tool is called.",
			},
		},
		required: ["name", "schedule", "agent_prompt"],
	},
};

export const deleteCronJobDefinition: LLMToolDefinition = {
	name: "delete_cron_job",
	description:
		"Disable a cron job by ID or name. The job is soft-disabled, not permanently deleted.",
	input_schema: {
		type: "object",
		properties: {
			cron_job_id: { type: "string", description: "ID of the cron job to disable" },
			name: { type: "string", description: "Name of the cron job to disable (alternative to ID)" },
		},
	},
};

export const triggerCronJobDefinition: LLMToolDefinition = {
	name: "trigger_cron_job",
	description:
		"Immediately trigger a cron job, bypassing its schedule and condition script. Optionally inject extra context.",
	input_schema: {
		type: "object",
		properties: {
			cron_job_id: { type: "string", description: "ID of the cron job to trigger" },
			name: { type: "string", description: "Name of the cron job to trigger (alternative to ID)" },
			extra_prompt: {
				type: "string",
				description: "Additional context appended to the task prompt for this run only",
			},
		},
	},
};

export const listCronJobsDefinition: LLMToolDefinition = {
	name: "list_cron_jobs",
	description:
		"List all cron jobs in this workspace with their status, schedule, and last run info.",
	input_schema: {
		type: "object",
		properties: {},
	},
};

// ─── Tool Executors ────────────────────────────────────

export function createCronToolExecutors(
	prisma: PrismaClient,
	scheduler: CronScheduler,
): Record<string, ToolExecutor> {
	return {
		async create_cron_job(
			args: Record<string, unknown>,
			ctx: ToolExecutionContext,
		): Promise<ToolResult> {
			const start = Date.now();
			const name = args.name as string;
			const schedule = args.schedule as string;
			const agentPrompt = args.agent_prompt as string;
			const description = (args.description as string) ?? null;
			const costTier = (args.cost_tier as number) ?? 1;
			const conditionScript = (args.condition_script as string) ?? null;
			const slackChannel = (args.slack_channel as string) ?? null;

			if (!isValidCronExpression(schedule)) {
				return {
					output: null,
					durationMs: Date.now() - start,
					error: `Invalid cron expression: "${schedule}". Use a standard 5-field POSIX cron expression.`,
				};
			}

			const warnings: string[] = [];
			const freqWarning = checkFrequencyWarning(schedule);
			if (freqWarning) warnings.push(freqWarning);

			const now = new Date();
			const nextRunAt = calculateNextRun(schedule, now);
			const runsPerDay = estimateRunsPerDay(schedule);

			const job = await prisma.cronJob.create({
				data: {
					workspaceId: ctx.workspaceId,
					name,
					schedule,
					description,
					agentPrompt,
					costTier: Math.min(Math.max(costTier, 1), 3),
					conditionScript,
					slackChannel,
					nextRunAt,
					type: "CUSTOM",
				},
			});

			return {
				output: {
					id: job.id,
					name: job.name,
					schedule,
					nextRunAt: nextRunAt.toISOString(),
					estimatedRunsPerDay: runsPerDay,
					costTier,
					warnings,
				},
				durationMs: Date.now() - start,
			};
		},

		async delete_cron_job(
			args: Record<string, unknown>,
			ctx: ToolExecutionContext,
		): Promise<ToolResult> {
			const start = Date.now();
			const cronJobId = args.cron_job_id as string | undefined;
			const name = args.name as string | undefined;

			if (!cronJobId && !name) {
				return {
					output: null,
					durationMs: Date.now() - start,
					error: "Provide either cron_job_id or name",
				};
			}

			const job = cronJobId
				? await prisma.cronJob.findFirst({
						where: { id: cronJobId, workspaceId: ctx.workspaceId },
					})
				: await prisma.cronJob.findFirst({
						where: { name, workspaceId: ctx.workspaceId, enabled: true },
					});

			if (!job) {
				return {
					output: null,
					durationMs: Date.now() - start,
					error: `Cron job not found: ${cronJobId ?? name}`,
				};
			}

			await prisma.cronJob.update({
				where: { id: job.id },
				data: { enabled: false },
			});

			return {
				output: { id: job.id, name: job.name, status: "disabled" },
				durationMs: Date.now() - start,
			};
		},

		async trigger_cron_job(
			args: Record<string, unknown>,
			ctx: ToolExecutionContext,
		): Promise<ToolResult> {
			const start = Date.now();
			const cronJobId = args.cron_job_id as string | undefined;
			const name = args.name as string | undefined;
			const extraPrompt = args.extra_prompt as string | undefined;

			if (!cronJobId && !name) {
				return {
					output: null,
					durationMs: Date.now() - start,
					error: "Provide either cron_job_id or name",
				};
			}

			const job = cronJobId
				? await prisma.cronJob.findFirst({
						where: { id: cronJobId, workspaceId: ctx.workspaceId },
					})
				: await prisma.cronJob.findFirst({
						where: { name, workspaceId: ctx.workspaceId },
					});

			if (!job) {
				return {
					output: null,
					durationMs: Date.now() - start,
					error: `Cron job not found: ${cronJobId ?? name}`,
				};
			}

			// Temporarily update the prompt if extra context provided
			if (extraPrompt) {
				await prisma.cronJob.update({
					where: { id: job.id },
					data: {
						nextRunAt: new Date(),
						agentPrompt: `${job.agentPrompt}\n\n## Additional Context\n${extraPrompt}`,
					},
				});
			} else {
				await prisma.cronJob.update({
					where: { id: job.id },
					data: { nextRunAt: new Date() },
				});
			}

			// The scheduler will pick it up on next tick
			return {
				output: {
					id: job.id,
					name: job.name,
					status: "triggered",
					message: "Job will execute on the next scheduler tick (~30s)",
				},
				durationMs: Date.now() - start,
			};
		},

		async list_cron_jobs(
			_args: Record<string, unknown>,
			ctx: ToolExecutionContext,
		): Promise<ToolResult> {
			const start = Date.now();
			const jobs = await prisma.cronJob.findMany({
				where: { workspaceId: ctx.workspaceId },
				orderBy: { createdAt: "asc" },
			});

			const output = jobs.map((job) => ({
				id: job.id,
				name: job.name,
				type: job.type,
				schedule: job.schedule,
				enabled: job.enabled,
				costTier: job.costTier,
				lastRunAt: job.lastRunAt?.toISOString() ?? null,
				nextRunAt: job.nextRunAt?.toISOString() ?? null,
				lastRunStatus: job.lastRunStatus,
				runCount: job.runCount,
				hasCondition: !!job.conditionScript,
				slackChannel: job.slackChannel,
			}));

			return {
				output: { jobs: output, total: output.length },
				durationMs: Date.now() - start,
			};
		},
	};
}
