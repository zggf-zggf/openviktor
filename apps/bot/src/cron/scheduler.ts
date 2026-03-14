import type { PrismaClient } from "@openviktor/db";
import type { Logger, TriggerType } from "@openviktor/shared";
import type { PromptContext } from "../agent/prompt.js";
import type { AgentRunner, RunTrigger } from "../agent/runner.js";
import { fetchActiveThreads } from "../thread/index.js";
import { buildChannelIntroPrompt } from "./channel-intro.js";
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
const SCRIPT_TIMEOUT_MS = 30_000;

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
	model: string | null;
	scriptCommand: string | null;
	dependentPaths: string[];
	lastRunAt: Date | null;
	runCount: number;
	maxRuns: number | null;
	workspace: { id: string; slackTeamName: string; settings: unknown };
}

export interface ScriptResult {
	exitCode: number;
	stdout: string;
	stderr: string;
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

		if (job.type === "SCRIPT") {
			await this.executeScriptJob(job, true);
			return;
		}

		const agentPrompt = extraPrompt
			? `${job.agentPrompt}\n\n## Additional Context\n${extraPrompt}`
			: job.agentPrompt;

		await this.executeJob({ ...job, agentPrompt }, true);
	}

	private async executeJob(job: CronJobRecord, skipCondition = false): Promise<void> {
		if (job.type === "SCRIPT") {
			await this.executeScriptJob(job, skipCondition);
			return;
		}

		const triggerType: TriggerType =
			job.type === "HEARTBEAT"
				? "HEARTBEAT"
				: job.type === "DISCOVERY"
					? "DISCOVERY"
					: job.type === "ONBOARDING"
						? "ONBOARDING"
						: "CRON";

		try {
			if (!skipCondition) {
				const shouldRun = await this.shouldJobRun(job);
				if (!shouldRun) return;
			}

			const { agentPrompt, heartbeatPrompt, discoveryPrompt, channelIntroPrompt } =
				await this.buildJobPrompt(job);

			const model = getModelForTier(job.costTier, this.config.defaultModel, job.model);

			const activeThreads = await fetchActiveThreads(this.prisma, job.workspaceId);

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
				channelIntroPrompt,
			};

			const slackThreadTs = `cron-${job.id}-${Date.now()}`;

			const trigger: RunTrigger = {
				workspaceId: job.workspaceId,
				memberId: null,
				triggerType,
				cronJobId: job.id,
				model,
				slackChannel: job.slackChannel ?? "general",
				slackThreadTs: `cron-${job.id}-${Date.now()}`,
				userMessage: agentPrompt,
				promptContext: {
					workspaceName: job.workspace.slackTeamName,
					channel: job.slackChannel ?? "general",
					triggerType,
					cronJobName: job.name,
					heartbeatPrompt,
				},
			};

			this.logger.info(
				{ cronJobId: job.id, name: job.name, triggerType, model },
				"Executing cron job",
			);

			const result = await this.runner.run(trigger);
			await this.updateJobAfterRun(job, "COMPLETED");

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

			await this.updateJobAfterRun(job, "FAILED");
			await this.checkConsecutiveFailures(job);
		}
	}

	private async shouldJobRun(job: CronJobRecord): Promise<boolean> {
		const costCheck = await checkCostControl(this.prisma, job.workspaceId, this.logger);
		if (!costCheck.allowed) {
			await this.updateJobAfterSkip(job);
			return false;
		}

		if (job.dependentPaths.length > 0) {
			const depsReady = await this.checkDependencies(job);
			if (!depsReady) {
				this.logger.info(
					{ cronJobId: job.id, name: job.name, dependentPaths: job.dependentPaths },
					"Dependencies not met, skipping",
				);
				await this.updateJobAfterSkip(job);
				return false;
			}
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
				return false;
			}
		}

		return true;
	}

	private async buildAgentPrompt(
		job: CronJobRecord,
	): Promise<{ agentPrompt: string; heartbeatPrompt?: string }> {
		if (job.type !== "HEARTBEAT") {
			return { agentPrompt: job.agentPrompt };
		}

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

	private async updateJobAfterRun(
		job: CronJobRecord,
		status: "COMPLETED" | "FAILED",
	): Promise<void> {
		const now = new Date();
		const newRunCount = job.runCount + 1;
		const reachedMaxRuns = job.maxRuns !== null && newRunCount >= job.maxRuns;
		await this.prisma.cronJob.update({
			where: { id: job.id },
			data: {
				lastRunAt: now,
				nextRunAt: reachedMaxRuns ? null : calculateNextRun(job.schedule, now),
				runCount: newRunCount,
				lastRunStatus: status,
				...(reachedMaxRuns ? { enabled: false } : {}),
			},
		});
		if (reachedMaxRuns) {
			this.logger.info(
				{ cronJobId: job.id, name: job.name, maxRuns: job.maxRuns },
				"Cron job reached max runs, auto-disabled",
			);
		}
	}

	private async checkConsecutiveFailures(job: CronJobRecord): Promise<void> {
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

	private async executeScriptJob(job: CronJobRecord, skipCondition = false): Promise<void> {
		try {
			if (!skipCondition) {
				const ready = await this.shouldScriptJobRun(job);
				if (!ready) return;
			}

			const command = job.scriptCommand ?? job.agentPrompt;
			this.logger.info({ cronJobId: job.id, name: job.name, command }, "Executing script cron");

			const result = await this.runScript(command);
			const status = result.exitCode === 0 ? "COMPLETED" : "FAILED";
			await this.updateJobAfterRun(job, status);

			this.logger.info(
				{
					cronJobId: job.id,
					name: job.name,
					exitCode: result.exitCode,
					stdout: result.stdout.slice(0, 500),
					status,
				},
				"Script cron completed",
			);
		} catch (error) {
			this.logger.error(
				{ cronJobId: job.id, name: job.name, err: error },
				"Script cron execution failed",
			);
			await this.updateJobAfterRun(job, "FAILED");
		}
	}

	private async shouldScriptJobRun(job: CronJobRecord): Promise<boolean> {
		if (job.dependentPaths.length > 0) {
			const depsReady = await this.checkDependencies(job);
			if (!depsReady) {
				this.logger.info(
					{ cronJobId: job.id, name: job.name, dependentPaths: job.dependentPaths },
					"Script cron dependencies not met, skipping",
				);
				await this.updateJobAfterSkip(job);
				return false;
			}
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
				this.logger.info(
					{ cronJobId: job.id, name: job.name },
					"Condition not met, skipping script cron",
				);
				await this.updateJobAfterSkip(job);
				return false;
			}
		}

		return true;
	}

	async runScript(command: string): Promise<ScriptResult> {
		const { execFile } = await import("node:child_process");
		const { promisify } = await import("node:util");
		const execFileAsync = promisify(execFile);

		try {
			const { stdout, stderr } = await execFileAsync("sh", ["-c", command], {
				timeout: SCRIPT_TIMEOUT_MS,
				maxBuffer: 1024 * 1024,
			});
			return { exitCode: 0, stdout, stderr };
		} catch (error: unknown) {
			const execError = error as {
				code?: number;
				stdout?: string;
				stderr?: string;
			};
			return {
				exitCode: execError.code ?? 1,
				stdout: execError.stdout ?? "",
				stderr: execError.stderr ?? "",
			};
		}
	}

	private async checkDependencies(job: CronJobRecord): Promise<boolean> {
		if (job.dependentPaths.length === 0) return true;

		const since = job.lastRunAt ?? new Date(0);

		for (const depPath of job.dependentPaths) {
			const depJob = await this.prisma.cronJob.findFirst({
				where: {
					workspaceId: job.workspaceId,
					name: depPath,
					enabled: true,
				},
				select: { lastRunAt: true, lastRunStatus: true },
			});

			if (!depJob) {
				this.logger.warn(
					{ cronJobId: job.id, dependentPath: depPath },
					"Dependent cron job not found",
				);
				return false;
			}

			if (!depJob.lastRunAt || depJob.lastRunAt <= since) {
				return false;
			}

			if (depJob.lastRunStatus !== "COMPLETED") {
				return false;
			}
		}

		return true;
	}

	private async buildJobPrompt(job: CronJobRecord): Promise<{
		agentPrompt: string;
		heartbeatPrompt?: string;
		discoveryPrompt?: string;
		channelIntroPrompt?: string;
	}> {
		if (job.type === "CHANNEL_INTRO") {
			return {
				agentPrompt:
					"Execute your channel introduction now. Follow the instructions in your system prompt.",
				channelIntroPrompt: buildChannelIntroPrompt(job.runCount),
			};
		}

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
