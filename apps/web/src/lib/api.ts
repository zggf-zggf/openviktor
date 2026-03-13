const API_BASE = "/api";

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
	const apiKey = localStorage.getItem("admin_api_key");
	const headers: HeadersInit = {
		"Content-Type": "application/json",
		...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
	};
	const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`API ${res.status}: ${body || res.statusText}`);
	}
	return res.json();
}

// ─── Types ──────────────────────────────────────────────

export interface OverviewStats {
	totalRuns: number;
	totalCost: number;
	successRate: number;
	activeThreads: number;
}

export interface DayBucket {
	date: string;
	runs: number;
	cost: number;
}

export interface ModelCost {
	model: string;
	cost: number;
	count: number;
}

export interface TriggerCount {
	trigger: string;
	count: number;
}

export interface OverviewData {
	stats: OverviewStats;
	runsByDay: DayBucket[];
	costByModel: ModelCost[];
	runsByTrigger: TriggerCount[];
	recentRuns: RunSummary[];
}

export interface RunSummary {
	id: string;
	status: string;
	triggerType: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	costCents: number;
	durationMs: number | null;
	createdAt: string;
	triggeredByName: string | null;
}

export interface RunDetail extends RunSummary {
	systemPrompt: string | null;
	errorMessage: string | null;
	startedAt: string | null;
	completedAt: string | null;
	messages: MessageItem[];
	toolCalls: ToolCallItem[];
	thread: {
		id: string;
		slackChannel: string;
		slackThreadTs: string;
		status: string;
	} | null;
}

export interface MessageItem {
	id: string;
	role: string;
	content: string;
	tokenCount: number;
	createdAt: string;
}

export interface ToolCallItem {
	id: string;
	toolName: string;
	toolType: string;
	input: unknown;
	output: unknown;
	status: string;
	durationMs: number | null;
	errorMessage: string | null;
	createdAt: string;
}

export interface Paginated<T> {
	data: T[];
	total: number;
	page: number;
	limit: number;
}

export interface ToolStat {
	toolName: string;
	totalCalls: number;
	successCount: number;
	failedCount: number;
	avgDurationMs: number;
	lastUsed: string | null;
}

export interface ToolsOverview {
	stats: ToolStat[];
	totalCalls: number;
	overallSuccessRate: number;
}

export interface ThreadItem {
	id: string;
	slackChannel: string;
	slackThreadTs: string;
	status: string;
	phase: number;
	runCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface LearningItem {
	id: string;
	content: string;
	source: string;
	category: string | null;
	createdAt: string;
}

export interface SkillItem {
	id: string;
	name: string;
	content: string;
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface CronJobItem {
	id: string;
	name: string;
	schedule: string;
	description: string | null;
	agentPrompt: string;
	costTier: number;
	enabled: boolean;
	lastRunAt: string | null;
	nextRunAt: string | null;
	createdAt: string;
}

export interface WorkspaceInfo {
	id: string;
	slackTeamId: string;
	slackTeamName: string;
	settings: Record<string, unknown>;
	createdAt: string;
	memberCount: number;
	members: { id: string; slackUserId: string; displayName: string | null }[];
}

// ─── API Functions ──────────────────────────────────────

export function getOverview(): Promise<OverviewData> {
	return fetchApi("/overview");
}

export function getRuns(params: {
	page?: number;
	limit?: number;
	status?: string;
	triggerType?: string;
	model?: string;
}): Promise<Paginated<RunSummary>> {
	const sp = new URLSearchParams();
	if (params.page) sp.set("page", String(params.page));
	if (params.limit) sp.set("limit", String(params.limit));
	if (params.status) sp.set("status", params.status);
	if (params.triggerType) sp.set("triggerType", params.triggerType);
	if (params.model) sp.set("model", params.model);
	return fetchApi(`/runs?${sp}`);
}

export function getRunDetail(id: string): Promise<RunDetail> {
	return fetchApi(`/runs/${encodeURIComponent(id)}`);
}

export function getToolsStats(): Promise<ToolsOverview> {
	return fetchApi("/tools/stats");
}

export function getThreads(params: {
	page?: number;
	limit?: number;
	status?: string;
}): Promise<Paginated<ThreadItem>> {
	const sp = new URLSearchParams();
	if (params.page) sp.set("page", String(params.page));
	if (params.limit) sp.set("limit", String(params.limit));
	if (params.status) sp.set("status", params.status);
	return fetchApi(`/threads?${sp}`);
}

export function getLearnings(params: {
	page?: number;
	limit?: number;
	search?: string;
}): Promise<Paginated<LearningItem>> {
	const sp = new URLSearchParams();
	if (params.page) sp.set("page", String(params.page));
	if (params.limit) sp.set("limit", String(params.limit));
	if (params.search) sp.set("search", params.search);
	return fetchApi(`/learnings?${sp}`);
}

export function getSkills(params: {
	page?: number;
	limit?: number;
}): Promise<Paginated<SkillItem>> {
	const sp = new URLSearchParams();
	if (params.page) sp.set("page", String(params.page));
	if (params.limit) sp.set("limit", String(params.limit));
	return fetchApi(`/skills?${sp}`);
}

export function getCronJobs(): Promise<CronJobItem[]> {
	return fetchApi("/cron-jobs");
}

export function toggleCronJob(id: string, enabled: boolean): Promise<CronJobItem> {
	return fetchApi(`/cron-jobs/${encodeURIComponent(id)}`, {
		method: "PATCH",
		body: JSON.stringify({ enabled }),
	});
}

export function getSettings(): Promise<WorkspaceInfo[]> {
	return fetchApi("/settings");
}
