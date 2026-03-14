import type { PrismaClient } from "@openviktor/db";
import type { Logger } from "@openviktor/shared";
import type { PromptContext } from "../agent/prompt.js";
import type { AgentRunner } from "../agent/runner.js";

export interface SpawnAgentRunParams {
	workspaceId: string;
	threadId: string;
	slackChannel: string;
	slackThreadTs: string;
	initialPrompt: string;
	dependentPaths?: string[];
}

export interface ThreadSpawnerConfig {
	prisma: PrismaClient;
	logger: Logger;
	getRunner: () => AgentRunner;
	defaultModel?: string;
	workspaceName: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEPENDENCY_POLL_MS = 5_000;
const DEPENDENCY_TIMEOUT_MS = 30 * 60 * 1000;

async function waitForDependencies(
	prisma: PrismaClient,
	workspaceId: string,
	paths: string[],
	logger: Logger,
): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < DEPENDENCY_TIMEOUT_MS) {
		const threads = await prisma.thread.findMany({
			where: { workspaceId, path: { in: paths } },
			select: { path: true, status: true },
		});

		const completedPaths = new Set(
			threads.filter((t) => t.status === "COMPLETED" || t.status === "STALE").map((t) => t.path),
		);

		if (paths.every((p) => completedPaths.has(p))) {
			return true;
		}

		logger.debug(
			{ completed: completedPaths.size, total: paths.length },
			"Waiting for dependent paths",
		);
		await sleep(DEPENDENCY_POLL_MS);
	}

	logger.warn({ paths }, "Dependency wait timed out");
	return false;
}

export function createThreadSpawner(config: ThreadSpawnerConfig) {
	return (params: SpawnAgentRunParams): void => {
		const run = async () => {
			try {
				if (params.dependentPaths && params.dependentPaths.length > 0) {
					const ok = await waitForDependencies(
						config.prisma,
						params.workspaceId,
						params.dependentPaths,
						config.logger,
					);
					if (!ok) {
						config.logger.error(
							{ threadId: params.threadId, paths: params.dependentPaths },
							"Spawned thread dependency wait timed out, proceeding anyway",
						);
					}
				}

				const promptContext: PromptContext = {
					workspaceName: config.workspaceName,
					channel: params.slackChannel,
					triggerType: "SPAWN",
				};

				await config.getRunner().run({
					workspaceId: params.workspaceId,
					memberId: null,
					triggerType: "SPAWN",
					slackChannel: params.slackChannel,
					slackThreadTs: params.slackThreadTs,
					userMessage: params.initialPrompt,
					promptContext,
				});
			} catch (error) {
				config.logger.error({ threadId: params.threadId, err: error }, "Spawned agent run failed");
			}
		};

		void run();
	};
}
