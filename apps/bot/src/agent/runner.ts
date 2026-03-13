import type { PrismaClient } from "@openviktor/db";
import type { ContentBlock, Logger, ToolUseBlock, TriggerType } from "@openviktor/shared";
import type { LLMMessage } from "@openviktor/shared";
import { type LLMGateway, extractText } from "./gateway.js";
import { type PromptContext, buildSystemPrompt } from "./prompt.js";

const MAX_TOOL_ROUNDS = 20;

export interface RunTrigger {
	workspaceId: string;
	memberId: string;
	triggerType: TriggerType;
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

export class AgentRunner {
	constructor(
		private prisma: PrismaClient,
		private llm: LLMGateway,
		private logger: Logger,
	) {}

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

			const messages = await this.buildMessages(thread.id, systemPrompt);
			const { responseText, inputTokens, outputTokens, costCents } = await this.execute(
				agentRun.id,
				messages,
			);

			await this.prisma.message.create({
				data: {
					agentRunId: agentRun.id,
					role: "assistant",
					content: responseText,
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
				responseText,
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

	private async buildMessages(threadId: string, systemPrompt: string): Promise<LLMMessage[]> {
		const history = await this.prisma.message.findMany({
			where: { agentRun: { threadId } },
			orderBy: { createdAt: "asc" },
		});

		const messages: LLMMessage[] = [{ role: "system", content: systemPrompt }];

		for (const msg of history) {
			if (msg.role === "user" || msg.role === "assistant") {
				messages.push({ role: msg.role, content: msg.content });
			}
		}

		return messages;
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

		for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
			const response = await this.llm.chat(messages);

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

			messages.push({ role: "assistant", content: response.content });

			const toolResults: ContentBlock[] = [];
			for (const toolUse of toolUses) {
				this.logger.warn(
					{ tool: toolUse.name, agentRunId },
					"Tool requested but no executors registered",
				);

				await this.prisma.toolCall.create({
					data: {
						agentRunId,
						toolName: toolUse.name,
						toolType: "NATIVE",
						input: toolUse.input as object,
						output: { error: "Tool execution not available" },
						status: "FAILED",
						errorMessage: "No tool executors registered",
					},
				});

				toolResults.push({
					type: "tool_result",
					tool_use_id: toolUse.id,
					content: "Error: This tool is not available. Please respond without using tools.",
					is_error: true,
				});
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
}
