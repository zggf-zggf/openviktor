import type { ToolResult } from "@openviktor/shared";
import type { ToolExecutionContext } from "./registry.js";

export interface ToolBackend {
	execute(
		toolName: string,
		args: Record<string, unknown>,
		ctx: ToolExecutionContext,
	): Promise<ToolResult>;
}

export class LocalToolBackend implements ToolBackend {
	private registry: { execute: ToolBackend["execute"] };

	constructor(registry: { execute: ToolBackend["execute"] }) {
		this.registry = registry;
	}

	async execute(
		toolName: string,
		args: Record<string, unknown>,
		ctx: ToolExecutionContext,
	): Promise<ToolResult> {
		return this.registry.execute(toolName, args, ctx);
	}
}

export interface ModalToolBackendOptions {
	endpointUrl: string;
	authToken?: string;
	timeoutMs?: number;
}

export class ModalToolBackend implements ToolBackend {
	private endpointUrl: string;
	private authToken: string | undefined;
	private timeoutMs: number;

	constructor(opts: ModalToolBackendOptions) {
		this.endpointUrl = opts.endpointUrl.replace(/\/+$/, "");
		this.authToken = opts.authToken;
		this.timeoutMs = opts.timeoutMs ?? 600_000;
	}

	async execute(
		toolName: string,
		args: Record<string, unknown>,
		ctx: ToolExecutionContext,
	): Promise<ToolResult> {
		const start = Date.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);

		try {
			const response = await fetch(this.endpointUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					tool_name: toolName,
					arguments: args,
					workspace_id: ctx.workspaceId,
					timeout_ms: ctx.timeoutMs,
					auth_token: this.authToken,
				}),
				signal: controller.signal,
			});

			const durationMs = Date.now() - start;

			if (!response.ok) {
				const body = await response.text();
				return {
					output: null,
					durationMs,
					error: `Modal error: ${response.status} - ${body}`,
				};
			}

			const data = (await response.json()) as {
				result?: unknown;
				error?: string;
			};

			if (data.error) {
				return { output: null, durationMs, error: data.error };
			}

			return { output: data.result ?? null, durationMs };
		} catch (error) {
			const durationMs = Date.now() - start;
			if (error instanceof DOMException && error.name === "AbortError") {
				return {
					output: null,
					durationMs,
					error: `Tool "${toolName}" timed out after ${this.timeoutMs}ms`,
				};
			}
			const message = error instanceof Error ? error.message : String(error);
			return {
				output: null,
				durationMs,
				error: `Modal request failed: ${message}`,
			};
		} finally {
			clearTimeout(timer);
		}
	}
}
