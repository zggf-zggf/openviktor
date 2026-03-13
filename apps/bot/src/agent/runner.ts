import type { PrismaClient } from "@openviktor/db";
import type {
	ContentBlock,
	LLMToolDefinition,
	Logger,
	ToolUseBlock,
	TriggerType,
} from "@openviktor/shared";
import type { LLMMessage } from "@openviktor/shared";
import type { ToolGatewayClient } from "@openviktor/tools";
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

export interface RunTrigger {
	workspaceId: string;
	memberId: string | null;
	triggerType: TriggerType;
	cronJobId?: string;
	slackChannel: string;
	slackThreadTs: string;
	userMessage: string;
	promptContext: PromptContext;
}

export interface RunResult {
	agentRunId: string;
	threadId: string;
	responseText: string;
	inputTokens: number;
	outputTokens: number;
	costCents: number;
	durationMs: number;
}

export interface ToolConfig {
	client: ToolGatewayClient;
	tools: LLMToolDefinition[];
}

export class AgentRunner {
	private toolConfig: ToolConfig | null;

	constructor(
		private prisma: PrismaClient,
		private llm: LLMGateway,
		private logger: Logger,
		toolConfig?: ToolConfig,
	) {
		this.toolConfig = toolConfig ?? null;
	}

	updateToolConfig(config: ToolConfig): void {
		this.toolConfig = config;
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
			update: { status: "ACTIVE" },
			create: {
				workspaceId: trigger.workspaceId,
				slackChannel: trigger.slackChannel,
				slackThreadTs: trigger.slackThreadTs,
				status: "ACTIVE",
			},
		});

		const systemPrompt = buildSystemPrompt(trigger.promptContext);

		const agentRun = await this.prisma.agentRun.create({
			data: {
				workspaceId: trigger.workspaceId,
				threadId: thread.id,
				triggeredBy: trigger.memberId,
				triggerType: trigger.triggerType,
				cronJobId: trigger.cronJobId ?? null,
				model: this.llm.getModel(),
				systemPrompt,
				startedAt: new Date(),
				status: "RUNNING",
			},
		});

		this.logger.info({ agentRunId: agentRun.id, threadId: thread.id }, "Agent run started");

		try {
			await this.prisma.message.create({
				data: {
					agentRunId: agentRun.id,
					role: "user",
					content: trigger.userMessage,
					slackChannel: trigger.slackChannel,
					slackThreadTs: trigger.slackThreadTs,
				},
			});

			const { messages, summaryUsage } = await this.buildMessages(thread, systemPrompt);
			const executeResult = await this.execute(agentRun.id, messages);

			const inputTokens = executeResult.inputTokens + (summaryUsage?.inputTokens ?? 0);
			const outputTokens = executeResult.outputTokens + (summaryUsage?.outputTokens ?? 0);
			const costCents = executeResult.costCents + (summaryUsage?.costCents ?? 0);

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

			this.logger.info(
				{ agentRunId: agentRun.id, durationMs, inputTokens, outputTokens, costCents },
				"Agent run completed",
			);

			return {
				agentRunId: agentRun.id,
				threadId: thread.id,
				responseText: executeResult.responseText,
				inputTokens,
				outputTokens,
				costCents,
				durationMs,
			};
		} catch (error) {
			const durationMs = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : String(error);

			this.logger.error({ agentRunId: agentRun.id, err: error }, "Agent run failed");

			try {
				await this.prisma.agentRun.update({
					where: { id: agentRun.id },
					data: {
						status: "FAILED",
						errorMessage,
						durationMs,
						completedAt: new Date(),
					},
				});
			} catch (updateError) {
				this.logger.error(
					{ agentRunId: agentRun.id, err: updateError },
					"Failed to update agent run status",
				);
			}

			throw error;
		}
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

	private async execute(
		agentRunId: string,
		messages: LLMMessage[],
	): Promise<{
		responseText: string;
		inputTokens: number;
		outputTokens: number;
		costCents: number;
	}> {
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCostCents = 0;

		const chatOptions: ChatOptions | undefined = this.toolConfig
			? { tools: this.toolConfig.tools }
			: undefined;

		for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
			const response = await this.llm.chat(messages, chatOptions);

			totalInputTokens += response.inputTokens;
			totalOutputTokens += response.outputTokens;
			totalCostCents += response.costCents;

			if (response.stopReason !== "tool_use") {
				return {
					responseText: extractText(response.content),
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
					inputTokens: totalInputTokens,
					outputTokens: totalOutputTokens,
					costCents: totalCostCents,
				};
			}

			messages.push({ role: "assistant", content: response.content });

			const toolResults: ContentBlock[] = [];
			for (const toolUse of toolUses) {
				const block = await this.executeTool(toolUse, agentRunId);
				toolResults.push(block);
			}

			messages.push({ role: "user", content: toolResults });
		}

		this.logger.warn({ agentRunId }, "Exceeded maximum tool rounds");
		return {
			responseText:
				"I apologize, but I encountered an issue processing your request. Please try again.",
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			costCents: totalCostCents,
		};
	}

	private async executeTool(toolUse: ToolUseBlock, agentRunId: string): Promise<ContentBlock> {
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
				type: "tool_result",
				tool_use_id: toolUse.id,
				content: "Error: This tool is not available. Please respond without using tools.",
				is_error: true,
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
				type: "tool_result",
				tool_use_id: toolUse.id,
				content: `Error: ${result.error}`,
				is_error: true,
			};
		}

		this.logger.info(
			{ tool: toolUse.name, agentRunId, durationMs: result.durationMs },
			"Tool gateway call completed",
		);
		const outputStr =
			typeof result.output === "string" ? result.output : JSON.stringify(result.output);
		return {
			type: "tool_result",
			tool_use_id: toolUse.id,
			content: outputStr,
		};
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
				toolType: "NATIVE",
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
