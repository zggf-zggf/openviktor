export type TriggerType =
	| "MENTION"
	| "DM"
	| "CRON"
	| "HEARTBEAT"
	| "DISCOVERY"
	| "MANUAL"
	| "SPAWN";

export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type ToolType = "NATIVE" | "MCP" | "PIPEDREAM" | "CUSTOM";

export type ThreadStatus = "ACTIVE" | "WAITING" | "COMPLETED" | "STALE";

export const ThreadPhase = {
	IDLE: 0,
	TRIGGER: 1,
	PROMPT_INJECTION: 2,
	THREAD_LOCK: 3,
	REASONING: 4,
	TOOL_LOOP: 5,
	DRAFT_GATE: 6,
	PROGRESS: 7,
	COMPLETION: 8,
} as const;

export type ThreadPhaseValue = (typeof ThreadPhase)[keyof typeof ThreadPhase];

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResultBlock {
	type: "tool_result";
	tool_use_id: string;
	content: string;
	is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface LLMToolDefinition {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export type StopReason =
	| "end_turn"
	| "max_tokens"
	| "tool_use"
	| "stop_sequence"
	| "pause_turn"
	| "refusal"
	| "model_context_window_exceeded";

export interface LLMMessage {
	role: "system" | "user" | "assistant";
	content: string | ContentBlock[];
}

export interface LLMResponse {
	id: string;
	content: ContentBlock[];
	stopReason: StopReason;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
	costCents: number;
}

export interface LLMProvider {
	chat(params: {
		model: string;
		messages: LLMMessage[];
		maxTokens?: number;
		tools?: LLMToolDefinition[];
		toolChoice?: "auto" | "any" | { type: "tool"; name: string };
		timeoutMs?: number;
	}): Promise<LLMResponse>;
}

export interface ToolDefinition {
	name: string;
	description: string;
	type: ToolType;
	schema: Record<string, unknown>;
}

export interface ToolResult {
	output: unknown;
	durationMs: number;
	error?: string;
}
