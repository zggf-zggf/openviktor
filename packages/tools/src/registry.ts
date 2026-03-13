import type { LLMToolDefinition, ToolResult } from "@openviktor/shared";
import { ToolExecutionError, ToolTimeoutError } from "@openviktor/shared";

export interface ToolExecutionContext {
	workspaceId: string;
	workspaceDir: string;
	timeoutMs: number;
}

export type ToolExecutor = (
	args: Record<string, unknown>,
	ctx: ToolExecutionContext,
) => Promise<ToolResult>;

interface RegisteredTool {
	definition: LLMToolDefinition;
	executor: ToolExecutor;
}

const CIRCUIT_BREAKER_THRESHOLD = 3;

export class ToolRegistry {
	private tools = new Map<string, RegisteredTool>();
	private failures = new Map<string, number>();

	register(name: string, definition: LLMToolDefinition, executor: ToolExecutor): void {
		this.tools.set(name, { definition, executor });
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	getDefinitions(): LLMToolDefinition[] {
		return Array.from(this.tools.values()).map((t) => t.definition);
	}

	async execute(
		name: string,
		args: Record<string, unknown>,
		ctx: ToolExecutionContext,
	): Promise<ToolResult> {
		const tool = this.tools.get(name);
		if (!tool) {
			return { output: null, durationMs: 0, error: `Unknown tool: ${name}` };
		}

		const failCount = this.failures.get(name) ?? 0;
		if (failCount >= CIRCUIT_BREAKER_THRESHOLD) {
			return {
				output: null,
				durationMs: 0,
				error: `Tool "${name}" circuit breaker open after ${failCount} consecutive failures`,
			};
		}

		const start = Date.now();
		try {
			const result = await Promise.race([
				tool.executor(args, ctx),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new ToolTimeoutError(name, ctx.timeoutMs)), ctx.timeoutMs),
				),
			]);
			if (result.error) {
				this.failures.set(name, failCount + 1);
			} else {
				this.failures.set(name, 0);
			}
			return { ...result, durationMs: Date.now() - start };
		} catch (error) {
			const durationMs = Date.now() - start;
			this.failures.set(name, failCount + 1);

			if (error instanceof ToolTimeoutError) {
				return { output: null, durationMs, error: error.message };
			}

			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs, error: message };
		}
	}

	resetCircuitBreaker(name: string): void {
		this.failures.delete(name);
	}

	resetAllCircuitBreakers(): void {
		this.failures.clear();
	}
}
