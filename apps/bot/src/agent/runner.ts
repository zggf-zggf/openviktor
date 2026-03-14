import type { PrismaClient } from "@openviktor/db";
import { ConcurrencyExceededError, ThreadLockedError, ThreadPhase } from "@openviktor/shared";
import type {
	ContentBlock,
	LLMToolDefinition,
	Logger,
	ToolUseBlock,
	TriggerType,
} from "@openviktor/shared";
import type { LLMMessage } from "@openviktor/shared";
import { type ToolGatewayClient, extractToolSchemas } from "@openviktor/tools";
import type { ConcurrencyLimiter } from "../thread/concurrency.js";
import { transitionPhase } from "../thread/lifecycle.js";
import type { ThreadLock } from "../thread/lock.js";
import {
	CONTEXT_WINDOW_SIZE,
	type StoredMessage,
	type SummaryResult,
	buildContextWindow,
	generateThreadSummary,
	needsNewSummary,
	parseThreadSummary,
} from "./context.js";
import { type ChatOptions, type LLMGateway, extractText } from "./gateway.js";
import { type PromptContext, buildSystemPrompt } from "./prompt.js";

const MAX_TOOL_ROUNDS = 20;

const SEND_TOOL_NAMES = new Set([
	"coworker_send_slack_message",
	"send_message_to_thread",
	"create_thread",
]);

export interface RunTrigger {
	workspaceId: string;
	memberId: string | null;
	triggerType: TriggerType;
	cronJobId?: string;
	model?: string;
	slackChannel: string;
	slackThreadTs: string;
	userMessage: string;
	promptContext: PromptContext;
}

export interface RunResult {
	agentRunId: string;
	threadId: string;
	responseText: string;
	messageSent: boolean;
	inputTokens: number;
	outputTokens: number;
	costCents: number;
	durationMs: number;
}

export interface ToolConfig {
	client: ToolGatewayClient;
	tools: LLMToolDefinition[];
}

export interface OrchestratorConfig {
	concurrencyLimiter: ConcurrencyLimiter;
	threadLock: ThreadLock;
	maxConcurrentRuns: number;
}

export class AgentRunner {
	private toolConfig: ToolConfig | null;
	private orchestrator: OrchestratorConfig | null;
	private messageBuffer = new Map<string, string[]>();

	constructor(
		private prisma: PrismaClient,
		private llm: LLMGateway,
		private logger: Logger,
		toolConfig?: ToolConfig,
		orchestrator?: OrchestratorConfig,
	) {
		this.toolConfig = toolConfig ?? null;
		this.orchestrator = orchestrator ?? null;
	}

	updateToolConfig(config: ToolConfig): void {
		this.toolConfig = config;
	}

	updateOrchestrator(config: OrchestratorConfig): void {
		this.orchestrator = config;
	}

	injectMessage(slackChannel: string, slackThreadTs: string, text: string): void {
		const key = `${slackChannel}:${slackThreadTs}`;
		const existing = this.messageBuffer.get(key) ?? [];
		existing.push(text);
		this.messageBuffer.set(key, existing);
	}

	private drainInjectedMessages(slackChannel: string, slackThreadTs: string): string[] {
		const key = `${slackChannel}:${slackThreadTs}`;
		const messages = this.messageBuffer.get(key) ?? [];
		if (messages.length > 0) {
			this.messageBuffer.delete(key);
		}
		return messages;
	}

	async run(trigger: RunTrigger): Promise<RunResult> {
		const startTime = Date.now();

		const thread = await this.prisma.thread.upsert({
			where: {
				workspaceId_slackChannel_slackThreadTs: {
					workspaceId: trigger.workspaceId,
					slackChannel: trigger.slackChannel,
					slackThreadTs: trigger.slackThreadTs,
				},
			},
			update: { status: "ACTIVE", phase: ThreadPhase.TRIGGER },
			create: {
				workspaceId: trigger.workspaceId,
				slackChannel: trigger.slackChannel,
				slackThreadTs: trigger.slackThreadTs,
				status: "ACTIVE",
				phase: ThreadPhase.TRIGGER,
			},
		});

		await this.ensureThreadNotLocked(thread.id);

		const systemPrompt = buildSystemPrompt(trigger.promptContext);
		const model = trigger.model ?? this.llm.getModel();

		const agentRun = await this.prisma.agentRun.create({
			data: {
				workspaceId: trigger.workspaceId,
				threadId: thread.id,
				triggeredBy: trigger.memberId,
				triggerType: trigger.triggerType,
				cronJobId: trigger.cronJobId ?? null,
				model,
				systemPrompt,
				startedAt: new Date(),
				status: "RUNNING",
			},
		});

		this.logger.info({ agentRunId: agentRun.id, threadId: thread.id }, "Agent run started");

		await this.acquireConcurrencyOrCancel(trigger.workspaceId, agentRun.id);

		let lockAcquired = false;
		try {
			await transitionPhase(this.prisma, thread.id, ThreadPhase.PROMPT_INJECTION);
			lockAcquired = await this.acquireThreadLockOrCancel(thread.id, agentRun.id);

			await this.prisma.message.create({
				data: {
					agentRunId: agentRun.id,
					role: "user",
					content: trigger.userMessage,
					slackChannel: trigger.slackChannel,
					slackThreadTs: trigger.slackThreadTs,
				},
			});

			await transitionPhase(this.prisma, thread.id, ThreadPhase.REASONING);

			const { messages, summaryUsage } = await this.buildMessages(thread, systemPrompt);
			const executeResult = await this.execute(
				agentRun.id,
				thread.id,
				messages,
				trigger.model,
				trigger.slackChannel,
				trigger.slackThreadTs,
			);

			const inputTokens = executeResult.inputTokens + (summaryUsage?.inputTokens ?? 0);
			const outputTokens = executeResult.outputTokens + (summaryUsage?.outputTokens ?? 0);
			const costCents = executeResult.costCents + (summaryUsage?.costCents ?? 0);

			await transitionPhase(this.prisma, thread.id, ThreadPhase.COMPLETION);

			await this.prisma.message.create({
				data: {
					agentRunId: agentRun.id,
					role: "assistant",
					content: executeResult.responseText,
					tokenCount: outputTokens,
				},
			});

			const durationMs = Date.now() - startTime;

			await this.prisma.agentRun.update({
				where: { id: agentRun.id },
				data: {
					status: "COMPLETED",
					inputTokens,
					outputTokens,
					costCents,
					durationMs,
					completedAt: new Date(),
				},
			});

			await this.prisma.thread.update({
				where: { id: thread.id },
				data: { status: "WAITING", phase: ThreadPhase.IDLE },
			});

			this.logger.info(
				{ agentRunId: agentRun.id, durationMs, inputTokens, outputTokens, costCents },
				"Agent run completed",
			);

			const remaining = this.drainInjectedMessages(trigger.slackChannel, trigger.slackThreadTs);
			if (remaining.length > 0) {
				this.logger.warn(
					{ agentRunId: agentRun.id, count: remaining.length },
					"Unprocessed injected messages at run completion",
				);
			}

			return {
				agentRunId: agentRun.id,
				threadId: thread.id,
				responseText: executeResult.responseText,
				messageSent: executeResult.messageSent,
				inputTokens,
				outputTokens,
				costCents,
				durationMs,
			};
		} catch (error) {
			await this.markRunFailed(agentRun.id, error, Date.now() - startTime);
			throw error;
		} finally {
			await this.releaseOrchestratorResources(
				thread.id,
				agentRun.id,
				trigger.workspaceId,
				lockAcquired,
			);
		}
	}

	private async ensureThreadNotLocked(threadId: string): Promise<void> {
		if (!this.orchestrator) return;
		const locked = await this.orchestrator.threadLock.isLocked(threadId);
		if (locked) {
			throw new ThreadLockedError(threadId);
		}
	}

	private async acquireConcurrencyOrCancel(workspaceId: string, agentRunId: string): Promise<void> {
		if (!this.orchestrator) return;
		const acquired = await this.orchestrator.concurrencyLimiter.acquire(workspaceId, agentRunId);
		if (!acquired) {
			await this.prisma.agentRun.update({
				where: { id: agentRunId },
				data: {
					status: "CANCELLED",
					errorMessage: "Concurrency limit exceeded",
					completedAt: new Date(),
				},
			});
			throw new ConcurrencyExceededError(workspaceId, this.orchestrator.maxConcurrentRuns);
		}
	}

	private async acquireThreadLockOrCancel(threadId: string, agentRunId: string): Promise<boolean> {
		if (!this.orchestrator) return false;
		const acquired = await this.orchestrator.threadLock.acquire(threadId, agentRunId);
		if (!acquired) {
			await this.prisma.agentRun.update({
				where: { id: agentRunId },
				data: {
					status: "CANCELLED",
					errorMessage: "Could not acquire thread lock",
					completedAt: new Date(),
				},
			});
			throw new ThreadLockedError(threadId);
		}
		return true;
	}

	private async markRunFailed(
		agentRunId: string,
		error: unknown,
		durationMs: number,
	): Promise<void> {
		if (error instanceof ThreadLockedError || error instanceof ConcurrencyExceededError) return;

		this.logger.error({ agentRunId, err: error }, "Agent run failed");
		const errorMessage = error instanceof Error ? error.message : String(error);

		try {
			await this.prisma.agentRun.update({
				where: { id: agentRunId },
				data: {
					status: "FAILED",
					errorMessage,
					durationMs,
					completedAt: new Date(),
				},
			});
		} catch (updateError) {
			this.logger.error({ agentRunId, err: updateError }, "Failed to update agent run status");
		}
	}

	private async releaseOrchestratorResources(
		threadId: string,
		agentRunId: string,
		workspaceId: string,
		lockAcquired: boolean,
	): Promise<void> {
		if (!this.orchestrator) return;
		if (lockAcquired) {
			await this.orchestrator.threadLock.release(threadId, agentRunId).catch((err) => {
				this.logger.error({ threadId, err }, "Failed to release thread lock");
			});
		}
		await this.orchestrator.concurrencyLimiter.release(workspaceId, agentRunId).catch((err) => {
			this.logger.error({ workspaceId, err }, "Failed to release concurrency slot");
		});
	}

	private async buildMessages(
		thread: { id: string; metadata: unknown },
		systemPrompt: string,
	): Promise<{
		messages: LLMMessage[];
		summaryUsage: { inputTokens: number; outputTokens: number; costCents: number } | null;
	}> {
		const history: StoredMessage[] = await this.prisma.message.findMany({
			where: { agentRun: { threadId: thread.id } },
			orderBy: { createdAt: "asc" },
		});

		if (history.length <= CONTEXT_WINDOW_SIZE) {
			return { messages: buildContextWindow(history, systemPrompt, null), summaryUsage: null };
		}

		const existingSummary = parseThreadSummary(thread.metadata);
		const cutoff = history.length - CONTEXT_WINDOW_SIZE;
		const olderMessages = history.slice(0, cutoff);

		if (!needsNewSummary(olderMessages, existingSummary)) {
			return {
				messages: buildContextWindow(history, systemPrompt, existingSummary?.summary ?? null),
				summaryUsage: null,
			};
		}

		let result: SummaryResult;
		try {
			result = await generateThreadSummary(olderMessages, this.llm);
		} catch (error) {
			this.logger.warn(
				{ threadId: thread.id, err: error },
				"Failed to generate thread summary, using truncation",
			);
			return { messages: buildContextWindow(history, systemPrompt, null), summaryUsage: null };
		}

		const lastOlder = olderMessages[olderMessages.length - 1];
		const metaBase =
			thread.metadata && typeof thread.metadata === "object" && !Array.isArray(thread.metadata)
				? (thread.metadata as Record<string, unknown>)
				: {};

		await this.prisma.thread.update({
			where: { id: thread.id },
			data: {
				metadata: {
					...metaBase,
					summary: result.summary,
					summarizedUpToId: lastOlder.id,
					summarizedCount: olderMessages.length,
				},
			},
		});

		this.logger.info(
			{ threadId: thread.id, summarizedCount: olderMessages.length },
			"Generated thread summary",
		);

		return {
			messages: buildContextWindow(history, systemPrompt, result.summary),
			summaryUsage: {
				inputTokens: result.inputTokens,
				outputTokens: result.outputTokens,
				costCents: result.costCents,
			},
		};
	}

	private buildChatOptions(
		activeTools: LLMToolDefinition[],
		modelOverride?: string,
	): ChatOptions | undefined {
		if (this.toolConfig) return { tools: activeTools, model: modelOverride };
		if (modelOverride) return { model: modelOverride };
		return undefined;
	}

	private mergeHotLoadedTools(
		activeTools: LLMToolDefinition[],
		loadedSkills: Set<string>,
		hotLoadedTools: LLMToolDefinition[],
	): void {
		for (const tool of hotLoadedTools) {
			if (loadedSkills.has(tool.name)) continue;
			activeTools.push(tool);
			loadedSkills.add(tool.name);
		}
	}

	private async execute(
		agentRunId: string,
		threadId: string,
		messages: LLMMessage[],
		modelOverride?: string,
		slackChannel?: string,
		slackThreadTs?: string,
	): Promise<{
		responseText: string;
		messageSent: boolean;
		inputTokens: number;
		outputTokens: number;
		costCents: number;
	}> {
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCostCents = 0;
		let messageSent = false;

		const activeTools = this.toolConfig ? [...this.toolConfig.tools] : [];
		const loadedSkills = new Set<string>();

		for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
			const response = await this.llm.chat(
				messages,
				this.buildChatOptions(activeTools, modelOverride),
			);

			totalInputTokens += response.inputTokens;
			totalOutputTokens += response.outputTokens;
			totalCostCents += response.costCents;

			if (response.stopReason !== "tool_use") {
				return {
					responseText: extractText(response.content),
					messageSent,
					inputTokens: totalInputTokens,
					outputTokens: totalOutputTokens,
					costCents: totalCostCents,
				};
			}

			const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
			if (toolUses.length === 0) {
				this.logger.warn({ agentRunId }, "stopReason=tool_use but no tool_use blocks returned");
				return {
					responseText:
						extractText(response.content) ||
						"I ran into an issue processing your request. Please try again.",
					messageSent,
					inputTokens: totalInputTokens,
					outputTokens: totalOutputTokens,
					costCents: totalCostCents,
				};
			}

			await transitionPhase(this.prisma, threadId, ThreadPhase.TOOL_LOOP);

			messages.push({ role: "assistant", content: response.content });

			const { toolResults, sentMessage, hotLoadedTools } = await this.processToolRound(
				toolUses,
				agentRunId,
				threadId,
				slackChannel,
				slackThreadTs,
			);
			if (sentMessage) messageSent = true;
			this.mergeHotLoadedTools(activeTools, loadedSkills, hotLoadedTools);

			messages.push({ role: "user", content: toolResults });

			await transitionPhase(this.prisma, threadId, ThreadPhase.REASONING);
		}

		this.logger.warn({ agentRunId }, "Exceeded maximum tool rounds");
		return {
			responseText:
				"I apologize, but I encountered an issue processing your request. Please try again.",
			messageSent,
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			costCents: totalCostCents,
		};
	}

	private extractHotLoadedTools(
		toolUse: ToolUseBlock,
		rawOutput: Record<string, unknown> | null,
		agentRunId: string,
	): LLMToolDefinition[] {
		if (toolUse.name !== "read_skill" || !rawOutput?.content) return [];
		const schemas = extractToolSchemas(rawOutput.content as string);
		if (!schemas) return [];
		this.logger.info(
			{ agentRunId, skill: rawOutput.name, toolCount: schemas.length },
			"Hot-loaded tool schemas from skill",
		);
		return schemas;
	}

	private async processToolRound(
		toolUses: ToolUseBlock[],
		agentRunId: string,
		threadId: string,
		slackChannel?: string,
		slackThreadTs?: string,
	): Promise<{
		toolResults: ContentBlock[];
		sentMessage: boolean;
		hotLoadedTools: LLMToolDefinition[];
	}> {
		let sentMessage = false;
		const toolResults: ContentBlock[] = [];
		const hotLoadedTools: LLMToolDefinition[] = [];

		for (const toolUse of toolUses) {
			if (SEND_TOOL_NAMES.has(toolUse.name)) {
				sentMessage = true;
			}
			const { block, rawOutput } = await this.executeToolWithOutput(toolUse, agentRunId);
			toolResults.push(block);
			hotLoadedTools.push(...this.extractHotLoadedTools(toolUse, rawOutput, agentRunId));
		}

		if (slackChannel && slackThreadTs) {
			const injected = this.drainInjectedMessages(slackChannel, slackThreadTs);
			for (const msg of injected) {
				toolResults.push({ type: "text" as const, text: `[New message from user]: ${msg}` });
				this.logger.info({ agentRunId, threadId }, "Injected mid-run message");
			}
		}

		return { toolResults, sentMessage, hotLoadedTools };
	}

	private async executeToolWithOutput(
		toolUse: ToolUseBlock,
		agentRunId: string,
	): Promise<{ block: ContentBlock; rawOutput: Record<string, unknown> | null }> {
		if (!this.toolConfig) {
			this.logger.warn(
				{ tool: toolUse.name, agentRunId },
				"Tool requested but no gateway configured",
			);
			await this.persistToolCall(
				agentRunId,
				toolUse,
				"FAILED",
				0,
				null,
				"No tool gateway configured",
			);
			return {
				block: {
					type: "tool_result",
					tool_use_id: toolUse.id,
					content: "Error: This tool is not available. Please respond without using tools.",
					is_error: true,
				},
				rawOutput: null,
			};
		}

		this.logger.info({ tool: toolUse.name, agentRunId }, "Calling tool gateway");
		const result = await this.toolConfig.client.call(toolUse.name, toolUse.input);
		const status = result.error ? "FAILED" : "COMPLETED";

		await this.persistToolCall(
			agentRunId,
			toolUse,
			status,
			result.durationMs,
			result.output,
			result.error,
		);

		if (result.error) {
			this.logger.warn(
				{ tool: toolUse.name, agentRunId, error: result.error, durationMs: result.durationMs },
				"Tool gateway call failed",
			);
			return {
				block: {
					type: "tool_result",
					tool_use_id: toolUse.id,
					content: `Error: ${result.error}`,
					is_error: true,
				},
				rawOutput: null,
			};
		}

		this.logger.info(
			{ tool: toolUse.name, agentRunId, durationMs: result.durationMs },
			"Tool gateway call completed",
		);
		const outputStr =
			typeof result.output === "string" ? result.output : JSON.stringify(result.output);
		const rawOutput =
			typeof result.output === "object" && result.output !== null
				? (result.output as Record<string, unknown>)
				: null;
		return {
			block: {
				type: "tool_result",
				tool_use_id: toolUse.id,
				content: outputStr,
			},
			rawOutput,
		};
	}

	private resolveToolType(toolName: string): "NATIVE" | "PIPEDREAM" | "MCP" | "CUSTOM" {
		if (toolName.startsWith("mcp_pd_")) return "PIPEDREAM";
		if (toolName.startsWith("mcp_")) return "MCP";
		return "NATIVE";
	}

	private async persistToolCall(
		agentRunId: string,
		toolUse: ToolUseBlock,
		status: "COMPLETED" | "FAILED",
		durationMs: number,
		output: unknown,
		error: string | undefined,
	): Promise<void> {
		await this.prisma.toolCall.create({
			data: {
				agentRunId,
				toolName: toolUse.name,
				toolType: this.resolveToolType(toolUse.name),
				input: toolUse.input as object,
				output: error
					? { error }
					: typeof output === "object" && output !== null
						? (output as object)
						: { value: output },
				status,
				durationMs,
				errorMessage: error ?? null,
			},
		});
	}
}
