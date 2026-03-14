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
	localOnly: boolean;
	discoverable: boolean;
}

const CIRCUIT_BREAKER_THRESHOLD = 3;

export class ToolRegistry {
	private tools = new Map<string, RegisteredTool>();
	private failures = new Map<string, number>();

	private scopedKey(workspaceId: string, name: string): string {
		return `ws:${workspaceId}:${name}`;
	}

	register(
		name: string,
		definition: LLMToolDefinition,
		executor: ToolExecutor,
		opts?: { localOnly?: boolean; discoverable?: boolean },
	): void {
		this.tools.set(name, {
			definition,
			executor,
			localOnly: opts?.localOnly ?? false,
			discoverable: opts?.discoverable ?? false,
		});
	}

	registerScoped(
		workspaceId: string,
		name: string,
		definition: LLMToolDefinition,
		executor: ToolExecutor,
		opts?: { localOnly?: boolean; discoverable?: boolean },
	): void {
		this.tools.set(this.scopedKey(workspaceId, name), {
			definition,
			executor,
			localOnly: opts?.localOnly ?? false,
			discoverable: opts?.discoverable ?? false,
		});
	}

	resolve(name: string, workspaceId?: string): string | undefined {
		if (workspaceId) {
			const key = this.scopedKey(workspaceId, name);
			if (this.tools.has(key)) return key;
		}
		if (this.tools.has(name)) return name;
		return undefined;
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	isLocalOnly(name: string): boolean {
		return this.tools.get(name)?.localOnly ?? false;
	}

	isDiscoverable(name: string): boolean {
		return this.tools.get(name)?.discoverable ?? false;
	}

	unregister(name: string): boolean {
		this.failures.delete(name);
		return this.tools.delete(name);
	}

	unregisterScoped(workspaceId: string, name: string): boolean {
		const key = this.scopedKey(workspaceId, name);
		this.failures.delete(key);
		return this.tools.delete(key);
	}

	getDefinitions(): LLMToolDefinition[] {
		return Array.from(this.tools.values())
			.filter((t) => !t.discoverable)
			.map((t) => t.definition);
	}

	getAllDefinitions(): LLMToolDefinition[] {
		return Array.from(this.tools.values()).map((t) => t.definition);
	}

	getDiscoverableDefinitions(prefix?: string, workspaceId?: string): LLMToolDefinition[] {
		return Array.from(this.tools.entries())
			.filter(([key, t]) => {
				if (!t.discoverable) return false;
				if (workspaceId) {
					const wsPrefix = `ws:${workspaceId}:`;
					if (!key.startsWith(wsPrefix)) return false;
					const name = key.slice(wsPrefix.length);
					return !prefix || name.startsWith(prefix);
				}
				return !prefix || key.startsWith(prefix);
			})
			.map(([, t]) => t.definition);
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
