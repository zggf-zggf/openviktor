import type { PrismaClient } from "@openviktor/db";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutionContext, ToolExecutor } from "../registry.js";

export interface SpawnAgentRunParams {
	workspaceId: string;
	threadId: string;
	slackChannel: string;
	slackThreadTs: string;
	initialPrompt: string;
	dependentPaths?: string[];
}

export interface ThreadOrchestrationDeps {
	prisma: PrismaClient;
	slackToken: string;
	spawnAgentRun: (params: SpawnAgentRunParams) => void;
}

// ─── Tool Definitions ───────────────────────────────────

export const createThreadDefinition: LLMToolDefinition = {
	name: "create_thread",
	description:
		"Spawn a new independent agent thread. The spawned agent runs with the given initial_prompt as its only context — it has NO access to the parent thread's conversation. Use this for deep work, research, or any task that should run in a separate context.",
	input_schema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "Thread path (e.g., '/heartbeat/threads/research')",
			},
			title: { type: "string", description: "Display title for the thread" },
			initial_prompt: {
				type: "string",
				description:
					"Full task description for the spawned agent. Include ALL necessary context — the spawned agent has NO parent context.",
			},
			channel: {
				type: "string",
				description: "Slack channel ID to post the thread root message",
			},
			dependent_paths: {
				type: "array",
				items: { type: "string" },
				description: "Thread paths that must complete before this thread starts execution",
			},
		},
		required: ["path", "title", "initial_prompt", "channel"],
	},
};

export const sendMessageToThreadDefinition: LLMToolDefinition = {
	name: "send_message_to_thread",
	description: "Send a message to another agent thread and optionally wake its agent for a reply.",
	input_schema: {
		type: "object",
		properties: {
			content: { type: "string", description: "Message content" },
			thread_id: { type: "string", description: "Target thread ID" },
			trigger_reply: {
				type: "boolean",
				description: "Whether to wake the target agent (default: true)",
			},
		},
		required: ["content", "thread_id"],
	},
};

export const waitForPathsDefinition: LLMToolDefinition = {
	name: "wait_for_paths",
	description:
		"Block until all specified thread paths finish execution. Returns when all paths are completed or timeout is reached.",
	input_schema: {
		type: "object",
		properties: {
			paths: {
				type: "array",
				items: { type: "string" },
				description: "Thread paths to wait for",
			},
			timeout_minutes: {
				type: "number",
				description: "Max wait time in minutes (default: 30)",
			},
		},
		required: ["paths"],
	},
};

export const listRunningPathsDefinition: LLMToolDefinition = {
	name: "list_running_paths",
	description: "Returns all currently executing thread paths in the workspace.",
	input_schema: {
		type: "object",
		properties: {},
	},
};

export const getPathInfoDefinition: LLMToolDefinition = {
	name: "get_path_info",
	description:
		"Returns detailed information about a thread or cron path — status, timestamps, run count.",
	input_schema: {
		type: "object",
		properties: {
			path: { type: "string", description: "Thread or cron path to look up" },
		},
		required: ["path"],
	},
};

// ─── Helpers ────────────────────────────────────────────

const SLACK_API_BASE_URL = "https://slack.com/api";

async function postSlackMessage(
	slackToken: string,
	channel: string,
	text: string,
	threadTs?: string,
): Promise<{ ok: true; ts: string; channel: string } | { ok: false; error: string }> {
	try {
		const params: Record<string, string> = { channel, text };
		if (threadTs) {
			params.thread_ts = threadTs;
		}
		const body = new URLSearchParams(params);
		const response = await fetch(`${SLACK_API_BASE_URL}/chat.postMessage`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${slackToken}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
		});
		if (!response.ok) {
			return { ok: false, error: `Slack API HTTP ${response.status}` };
		}
		const payload = (await response.json()) as Record<string, unknown>;
		if (payload.ok !== true) {
			const errMsg = typeof payload.error === "string" ? payload.error : "unknown";
			return { ok: false, error: `Slack error: ${errMsg}` };
		}
		return {
			ok: true,
			ts: payload.ts as string,
			channel: typeof payload.channel === "string" ? payload.channel : channel,
		};
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequiredString(args: Record<string, unknown>, key: string): string | null {
	const value = args[key];
	if (typeof value !== "string" || value.length === 0) return null;
	return value;
}

// ─── Executor Factories ─────────────────────────────────

export function createCreateThreadExecutor(deps: ThreadOrchestrationDeps): ToolExecutor {
	return async (args: Record<string, unknown>, ctx: ToolExecutionContext) => {
		try {
			const path = getRequiredString(args, "path");
			const title = getRequiredString(args, "title");
			const initialPrompt = getRequiredString(args, "initial_prompt");
			const channel = getRequiredString(args, "channel");
			const dependentPaths = (args.dependent_paths as string[] | undefined) ?? [];

			if (!path || !title || !initialPrompt || !channel) {
				return { output: null, durationMs: 0, error: "Missing required parameters" };
			}

			const existing = await deps.prisma.thread.findUnique({
				where: { workspaceId_path: { workspaceId: ctx.workspaceId, path } },
			});
			if (existing) {
				return {
					output: null,
					durationMs: 0,
					error: `Thread path already exists: ${path}`,
				};
			}

			const slackResult = await postSlackMessage(
				deps.slackToken,
				channel,
				`*${title}*\n_Spawning agent thread..._`,
			);
			if (!slackResult.ok) {
				return { output: null, durationMs: 0, error: slackResult.error };
			}

			const thread = await deps.prisma.thread.create({
				data: {
					workspaceId: ctx.workspaceId,
					slackChannel: slackResult.channel,
					slackThreadTs: slackResult.ts,
					path,
					title,
					status: "ACTIVE",
				},
			});

			deps.spawnAgentRun({
				workspaceId: ctx.workspaceId,
				threadId: thread.id,
				slackChannel: slackResult.channel,
				slackThreadTs: slackResult.ts,
				initialPrompt,
				dependentPaths: dependentPaths.length > 0 ? dependentPaths : undefined,
			});

			return {
				output: {
					status: "created",
					thread_id: thread.id,
					path,
					slack_ts: slackResult.ts,
				},
				durationMs: 0,
			};
		} catch (error) {
			return {
				output: null,
				durationMs: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
}

export function createSendMessageToThreadExecutor(deps: ThreadOrchestrationDeps): ToolExecutor {
	return async (args: Record<string, unknown>, ctx: ToolExecutionContext) => {
		try {
			const content = getRequiredString(args, "content");
			const threadId = getRequiredString(args, "thread_id");
			const triggerReply = (args.trigger_reply as boolean) ?? true;

			if (!content || !threadId) {
				return { output: null, durationMs: 0, error: "Missing required parameters" };
			}

			const thread = await deps.prisma.thread.findUnique({
				where: { id: threadId },
				select: {
					id: true,
					workspaceId: true,
					slackChannel: true,
					slackThreadTs: true,
				},
			});
			if (!thread) {
				return {
					output: null,
					durationMs: 0,
					error: `Thread not found: ${threadId}`,
				};
			}

			const slackResult = await postSlackMessage(
				deps.slackToken,
				thread.slackChannel,
				content,
				thread.slackThreadTs,
			);
			if (!slackResult.ok) {
				return { output: null, durationMs: 0, error: slackResult.error };
			}

			const latestRun = await deps.prisma.agentRun.findFirst({
				where: { threadId: thread.id },
				orderBy: { createdAt: "desc" },
				select: { id: true },
			});
			if (latestRun) {
				await deps.prisma.message.create({
					data: {
						agentRunId: latestRun.id,
						role: "user",
						content,
						slackChannel: thread.slackChannel,
						slackThreadTs: thread.slackThreadTs,
					},
				});
			}

			if (triggerReply) {
				deps.spawnAgentRun({
					workspaceId: thread.workspaceId,
					threadId: thread.id,
					slackChannel: thread.slackChannel,
					slackThreadTs: thread.slackThreadTs,
					initialPrompt: content,
				});
			}

			return {
				output: { status: "sent", message_ts: slackResult.ts },
				durationMs: 0,
			};
		} catch (error) {
			return {
				output: null,
				durationMs: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
}

const WAIT_POLL_INTERVAL_MS = 5_000;

export function createWaitForPathsExecutor(deps: ThreadOrchestrationDeps): ToolExecutor {
	return async (args: Record<string, unknown>, ctx: ToolExecutionContext) => {
		try {
			const paths = args.paths;
			const timeoutMinutes = (args.timeout_minutes as number) ?? 30;

			if (!Array.isArray(paths) || paths.length === 0) {
				return {
					output: null,
					durationMs: 0,
					error: "paths must be a non-empty array of strings",
				};
			}

			const pathList = paths as string[];
			const timeoutMs = timeoutMinutes * 60 * 1000;
			const start = Date.now();

			while (Date.now() - start < timeoutMs) {
				const threads = await deps.prisma.thread.findMany({
					where: {
						workspaceId: ctx.workspaceId,
						path: { in: pathList },
					},
					select: { path: true, status: true },
				});

				const completedPaths = new Set(
					threads
						.filter((t) => t.status === "COMPLETED" || t.status === "STALE")
						.map((t) => t.path),
				);

				if (pathList.every((p) => completedPaths.has(p))) {
					return {
						output: {
							waited_seconds: Math.round((Date.now() - start) / 1000),
							paths_waited_for: pathList,
							timed_out: false,
						},
						durationMs: 0,
					};
				}

				await sleep(WAIT_POLL_INTERVAL_MS);
			}

			return {
				output: {
					waited_seconds: Math.round((Date.now() - start) / 1000),
					paths_waited_for: pathList,
					timed_out: true,
				},
				durationMs: 0,
			};
		} catch (error) {
			return {
				output: null,
				durationMs: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
}

export function createListRunningPathsExecutor(deps: ThreadOrchestrationDeps): ToolExecutor {
	return async (_args: Record<string, unknown>, ctx: ToolExecutionContext) => {
		try {
			const threads = await deps.prisma.thread.findMany({
				where: {
					workspaceId: ctx.workspaceId,
					status: { in: ["ACTIVE", "WAITING"] },
					path: { not: null },
				},
				select: { path: true },
				orderBy: { createdAt: "asc" },
			});

			return {
				output: { running_paths: threads.map((t) => t.path).filter(Boolean) },
				durationMs: 0,
			};
		} catch (error) {
			return {
				output: null,
				durationMs: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
}

export function createGetPathInfoExecutor(deps: ThreadOrchestrationDeps): ToolExecutor {
	return async (args: Record<string, unknown>, ctx: ToolExecutionContext) => {
		try {
			const path = getRequiredString(args, "path");
			if (!path) {
				return { output: null, durationMs: 0, error: "Missing required parameter: path" };
			}

			const thread = await deps.prisma.thread.findFirst({
				where: { workspaceId: ctx.workspaceId, path },
				select: {
					id: true,
					path: true,
					title: true,
					status: true,
					phase: true,
					createdAt: true,
					updatedAt: true,
					parentThreadId: true,
					_count: { select: { agentRuns: true } },
				},
			});

			if (thread) {
				return {
					output: {
						info: {
							path_type: "thread",
							thread: {
								id: thread.id,
								title: thread.title,
								status: thread.status,
								phase: thread.phase,
								path: thread.path,
								parent_thread_id: thread.parentThreadId,
								created_at: thread.createdAt.toISOString(),
								updated_at: thread.updatedAt.toISOString(),
								agent_runs_count: thread._count.agentRuns,
							},
						},
					},
					durationMs: 0,
				};
			}

			const cronName = path.replace(/^\//, "").split("/")[0];
			const cronJob = await deps.prisma.cronJob.findFirst({
				where: {
					workspaceId: ctx.workspaceId,
					name: { equals: cronName, mode: "insensitive" },
				},
				select: {
					id: true,
					name: true,
					schedule: true,
					description: true,
					type: true,
					enabled: true,
					lastRunAt: true,
					runCount: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			if (cronJob) {
				return {
					output: {
						info: {
							path_type: "cron",
							cron: {
								id: cronJob.id,
								path: `/${cronJob.name.toLowerCase()}`,
								title: cronJob.name,
								description: cronJob.description,
								schedule: cronJob.schedule,
								type: cronJob.type,
								enabled: cronJob.enabled,
								last_run_at: cronJob.lastRunAt?.toISOString() ?? null,
								run_count: cronJob.runCount,
								created_at: cronJob.createdAt.toISOString(),
								updated_at: cronJob.updatedAt.toISOString(),
							},
						},
					},
					durationMs: 0,
				};
			}

			return {
				output: { info: { path_type: "not_found" } },
				durationMs: 0,
			};
		} catch (error) {
			return {
				output: null,
				durationMs: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
}
