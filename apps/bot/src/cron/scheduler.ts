import type { PrismaClient } from "@openviktor/db";
import type { Logger, TriggerType } from "@openviktor/shared";
import type { PromptContext } from "../agent/prompt.js";
import type { AgentRunner, RunTrigger } from "../agent/runner.js";
import { type ConditionContext, evaluateCondition } from "./condition.js";
import { checkCostControl, getModelForTier } from "./cost-control.js";
import { calculateNextRun } from "./cron-parser.js";
import { buildDiscoveryPrompt } from "./discovery.js";
import {
	DEFAULT_THRESHOLDS,
	type EngagementThresholds,
	buildHeartbeatPrompt,
} from "./heartbeat.js";

const MAX_CONCURRENT_RUNS = 4;
const MAX_CONSECUTIVE_FAILURES = 3;

export interface SchedulerConfig {
	checkIntervalMs: number;
	heartbeatEnabled: boolean;
	slackToken: string;
	defaultModel: string;
}

interface CronJobRecord {
	id: string;
	workspaceId: string;
	name: string;
	schedule: string;
	type: string;
	costTier: number;
	agentPrompt: string;
	conditionScript: string | null;
	slackChannel: string | null;
	lastRunAt: Date | null;
	runCount: number;
	workspace: { id: string; slackTeamName: string; settings: unknown };
}

export class CronScheduler {
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = new Set<string>();
	private ticking = false;

	constructor(
		private prisma: PrismaClient,
		private runner: AgentRunner,
		private logger: Logger,
		private config: SchedulerConfig,
	) {}

	start(): void {
		if (this.timer) return;
		this.logger.info({ intervalMs: this.config.checkIntervalMs }, "Cron scheduler started");
		this.timer = setInterval(() => this.tick(), this.config.checkIntervalMs);
		this.tick();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
			this.logger.info("Cron scheduler stopped");
		}
	}

	async tick(): Promise<void> {
		if (this.ticking) return;
		this.ticking = true;

		try {
			const now = new Date();
			const dueJobs = await this.prisma.cronJob.findMany({
				where: {
					enabled: true,
					nextRunAt: { lte: now },
				},
				include: { workspace: true },
			});

			if (dueJobs.length === 0) {
				return;
			}

			this.logger.info({ count: dueJobs.length }, "Due cron jobs found");

			for (const job of dueJobs) {
				if (this.running.size >= MAX_CONCURRENT_RUNS) {
					this.logger.info("Max concurrent cron runs reached, deferring");
					break;
				}
				if (this.running.has(job.id)) continue;

				if (!this.config.heartbeatEnabled && job.type === "HEARTBEAT") {
					continue;
				}

				this.running.add(job.id);
				this.executeJob(job).finally(() => this.running.delete(job.id));
			}
		} catch (error) {
			this.logger.error({ err: error }, "Cron scheduler tick failed");
		} finally {
			this.ticking = false;
		}
	}

	async triggerJob(jobId: string, extraPrompt?: string): Promise<void> {
		const job = await this.prisma.cronJob.findFirst({
			where: { id: jobId },
			include: { workspace: true },
		});
		if (!job) throw new Error(`Cron job not found: ${jobId}`);

		const agentPrompt = extraPrompt
			? `${job.agentPrompt}\n\n## Additional Context\n${extraPrompt}`
			: job.agentPrompt;

		await this.executeJob({ ...job, agentPrompt }, true);
	}

	private async executeJob(job: CronJobRecord, skipCondition = false): Promise<void> {
		const triggerType: TriggerType =
			job.type === "HEARTBEAT" ? "HEARTBEAT" : job.type === "DISCOVERY" ? "DISCOVERY" : "CRON";

		try {
			if (!skipCondition) {
				const costCheck = await checkCostControl(this.prisma, job.workspaceId, this.logger);
				if (!costCheck.allowed) {
					await this.updateJobAfterSkip(job);
					return;
				}

				if (job.conditionScript) {
					const condCtx: ConditionContext = {
						workspaceId: job.workspaceId,
						cronJobId: job.id,
						lastRunAt: job.lastRunAt,
					};
					const shouldRun = await evaluateCondition(
						job.conditionScript,
						condCtx,
						this.prisma,
						this.logger,
					);
					if (!shouldRun) {
						this.logger.info({ cronJobId: job.id, name: job.name }, "Condition not met, skipping");
						await this.updateJobAfterSkip(job);
						return;
					}
				}
			}

			const { agentPrompt, heartbeatPrompt, discoveryPrompt } = await this.buildJobPrompt(job);

			const model = getModelForTier(job.costTier, this.config.defaultModel);

			const activeThreads = await this.loadActiveThreads(job.workspaceId);

			const promptContext: PromptContext = {
				workspaceName: job.workspace.slackTeamName,
				channel: job.slackChannel ?? "general",
				triggerType,
				cronJobName: job.name,
				cronAgentPrompt: triggerType === "CRON" ? agentPrompt : undefined,
				cronRunCount: job.runCount,
				activeThreads,
				heartbeatPrompt,
				discoveryPrompt,
			};

			const slackThreadTs = `cron-${job.id}-${Date.now()}`;

			const trigger: RunTrigger = {
				workspaceId: job.workspaceId,
				memberId: null,
				triggerType,
				cronJobId: job.id,
				model,
				slackChannel: job.slackChannel ?? "general",
				slackThreadTs,
				userMessage: agentPrompt,
				promptContext,
			};

			this.logger.info(
				{ cronJobId: job.id, name: job.name, triggerType, model },
				"Executing cron job",
			);

			const result = await this.runner.run(trigger);

			const now = new Date();
			await this.prisma.cronJob.update({
				where: { id: job.id },
				data: {
					lastRunAt: now,
					nextRunAt: calculateNextRun(job.schedule, now),
					runCount: job.runCount + 1,
					lastRunStatus: "COMPLETED",
				},
			});

			this.logger.info(
				{
					cronJobId: job.id,
					name: job.name,
					agentRunId: result.agentRunId,
					durationMs: result.durationMs,
					costCents: result.costCents,
				},
				"Cron job completed",
			);
		} catch (error) {
			this.logger.error(
				{ cronJobId: job.id, name: job.name, err: error },
				"Cron job execution failed",
			);

			const now = new Date();
			await this.prisma.cronJob.update({
				where: { id: job.id },
				data: {
					lastRunAt: now,
					nextRunAt: calculateNextRun(job.schedule, now),
					runCount: job.runCount + 1,
					lastRunStatus: "FAILED",
				},
			});

			const recentRuns = await this.prisma.agentRun.findMany({
				where: { cronJobId: job.id },
				orderBy: { createdAt: "desc" },
				take: MAX_CONSECUTIVE_FAILURES,
				select: { status: true },
			});

			const allFailed =
				recentRuns.length >= MAX_CONSECUTIVE_FAILURES &&
				recentRuns.every((r) => r.status === "FAILED");

			if (allFailed) {
				this.logger.warn(
					{ cronJobId: job.id, name: job.name },
					`Cron job has ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
				);
			}
		}
	}

	private async buildJobPrompt(job: CronJobRecord): Promise<{
		agentPrompt: string;
		heartbeatPrompt?: string;
		discoveryPrompt?: string;
	}> {
		if (job.type === "HEARTBEAT") {
			const learnings = await this.loadLearnings(job.workspaceId);
			const settings = job.workspace.settings as Record<string, unknown> | null;
			const heartbeatSettings = settings?.heartbeat as Record<string, unknown> | undefined;
			const thresholds = {
				...DEFAULT_THRESHOLDS,
				...(heartbeatSettings?.thresholds as Partial<EngagementThresholds> | undefined),
			};
			return {
				agentPrompt:
					"Execute your heartbeat check-in now. Follow the instructions in your system prompt.",
				heartbeatPrompt: buildHeartbeatPrompt(learnings, thresholds),
			};
		}

		if (job.type === "DISCOVERY") {
			const learnings = await this.loadLearnings(job.workspaceId);
			return {
				agentPrompt:
					"Execute your workflow discovery run now. Follow the instructions in your system prompt.",
				discoveryPrompt: buildDiscoveryPrompt(learnings),
			};
		}

		return { agentPrompt: job.agentPrompt };
	}

	private async updateJobAfterSkip(job: { id: string; schedule: string }): Promise<void> {
		const now = new Date();
		await this.prisma.cronJob.update({
			where: { id: job.id },
			data: {
				nextRunAt: calculateNextRun(job.schedule, now),
			},
		});
	}

	private async loadActiveThreads(workspaceId: string): Promise<string[]> {
		const threads = await this.prisma.thread.findMany({
			where: {
				workspaceId,
				status: "ACTIVE",
			},
			select: { slackChannel: true, slackThreadTs: true },
			take: 20,
		});
		return threads.map((t) => `${t.slackChannel}/${t.slackThreadTs}`);
	}

	private async loadLearnings(workspaceId: string): Promise<string[]> {
		const learnings = await this.prisma.learning.findMany({
			where: { workspaceId },
			orderBy: { createdAt: "desc" },
			take: 50,
			select: { content: true },
		});
		return learnings.map((l) => l.content);
	}
}
