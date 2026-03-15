import type { PrismaClient } from "@openviktor/db";
import type { PipedreamClient } from "@openviktor/integrations";
import type { EnvConfig, Logger } from "@openviktor/shared";
import type { IntegrationWatcher } from "../integrations/watcher.js";
import type { AuthContext } from "../middleware/auth.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import type { ConnectionManager } from "../slack/connection-manager.js";

interface DashboardApiDeps {
	config: EnvConfig;
	prisma: PrismaClient;
	connectionManager?: ConnectionManager;
	pdClient?: PipedreamClient;
	integrationWatcher?: IntegrationWatcher;
	disconnectApp?: (workspaceId: string, appSlug: string) => Promise<{ removed: string[] }>;
	logger: Logger;
}

const SCHEDULED_TRIGGER_TYPES = ["CRON", "HEARTBEAT", "DISCOVERY"];

function formatCost(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M tokens`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k tokens`;
	return `${count} tokens`;
}

function formatRelativeTime(date: Date): string {
	const diffMs = Date.now() - date.getTime();
	const diffMin = Math.floor(diffMs / 60_000);
	const diffHours = Math.floor(diffMs / 3_600_000);
	const diffDays = Math.floor(diffMs / 86_400_000);
	const diffWeeks = Math.floor(diffDays / 7);

	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 7) return diffDays === 1 ? "yesterday" : `${diffDays}d ago`;
	if (diffWeeks < 4) return `${diffWeeks}w ago`;
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getInitials(name: string): string {
	return name
		.trim()
		.split(/\s+/)
		.map((p) => p[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}

export function createDashboardApi(deps: DashboardApiDeps) {
	const { config, prisma, connectionManager, pdClient, integrationWatcher, disconnectApp, logger } =
		deps;
	const auth = createAuthMiddleware({ config, prisma, logger });

	async function getWorkspace(workspaceId?: string | null) {
		if (workspaceId) {
			const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
			if (!workspace) throw new Error("Workspace not found");
			return workspace;
		}
		// Fallback for backward compatibility: return first workspace
		const workspace = await prisma.workspace.findFirst({ where: { isActive: true } });
		if (!workspace) throw new Error("No workspace found. Set up the bot first.");
		return workspace;
	}

	async function handleWorkspaces(authCtx: AuthContext): Promise<Response> {
		const where: Record<string, unknown> = { isActive: true };
		if (authCtx.mode === "slack-oauth" && authCtx.workspaceIds) {
			where.id = { in: authCtx.workspaceIds };
		}

		const workspaces = await prisma.workspace.findMany({
			where,
			select: {
				id: true,
				slackTeamName: true,
				slackTeamId: true,
				isActive: true,
				createdAt: true,
				settings: true,
			},
			orderBy: { createdAt: "asc" },
		});

		return Response.json({ workspaces });
	}

	async function handleWorkspace(workspaceId: string | null): Promise<Response> {
		const workspace = await getWorkspace(workspaceId);
		return Response.json({
			id: workspace.id,
			slackTeamName: workspace.slackTeamName,
			settings: workspace.settings,
		});
	}

	async function handleIntegrations(workspaceId: string | null): Promise<Response> {
		const workspace = await getWorkspace(workspaceId);

		const [accounts, toolDefs] = await Promise.all([
			prisma.integrationAccount.findMany({
				where: { workspaceId: workspace.id, status: "ACTIVE" },
				select: { appSlug: true },
			}),
			prisma.toolDefinition.findMany({
				where: { workspaceId: workspace.id, name: { startsWith: "mcp_pd_" } },
				select: { name: true },
			}),
		]);

		const connectedSlugs = accounts.map((a) => a.appSlug);

		const toolCounts: Record<string, number> = {};
		for (const tool of toolDefs) {
			const match = tool.name.match(/^mcp_pd_([^_]+(?:_[^_]+)*?)_[^_]+$/);
			if (match) {
				const slug = match[1];
				toolCounts[slug] = (toolCounts[slug] ?? 0) + 1;
			}
		}

		let apps: Array<{
			slug: string;
			name: string;
			description: string;
			imgSrc?: string;
			categories: string[];
		}> = [];

		if (pdClient) {
			const pdApps = await pdClient.listApps({ hasActions: true, limit: 50 });
			apps = pdApps.map((app) => ({
				slug: app.name_slug,
				name: app.name,
				description: app.description ?? "",
				imgSrc: app.img_src,
				categories: app.categories ?? [],
			}));
		}

		return Response.json({ apps, connectedSlugs, toolCounts });
	}

	async function handleConnect(req: Request, workspaceId: string | null): Promise<Response> {
		if (!pdClient) {
			return Response.json({ error: "Pipedream not configured" }, { status: 503 });
		}

		const { appSlug } = (await req.json()) as { appSlug: string };
		if (!appSlug) {
			return Response.json({ error: "appSlug is required" }, { status: 400 });
		}

		const workspace = await getWorkspace(workspaceId);
		const externalUserId = `workspace_${workspace.id}`;
		const token = await pdClient.createConnectToken(externalUserId);
		const separator = token.connect_link_url.includes("?") ? "&" : "?";
		const connectUrl = `${token.connect_link_url}${separator}app=${appSlug}`;

		integrationWatcher?.watch(workspace.id, appSlug);

		return Response.json({ connectUrl });
	}

	async function handleDisconnect(req: Request, workspaceId: string | null): Promise<Response> {
		const { appSlug } = (await req.json()) as { appSlug: string };
		if (!appSlug) {
			return Response.json({ error: "appSlug is required" }, { status: 400 });
		}

		const workspace = await getWorkspace(workspaceId);

		if (disconnectApp) {
			await disconnectApp(workspace.id, appSlug);
		} else {
			await prisma.integrationAccount.updateMany({
				where: { workspaceId: workspace.id, appSlug, status: "ACTIVE" },
				data: { status: "REVOKED" },
			});
			await prisma.toolDefinition.deleteMany({
				where: { workspaceId: workspace.id, name: { startsWith: `mcp_pd_${appSlug}_` } },
			});
		}

		return Response.json({ success: true });
	}

	async function handleUsage(workspaceId: string | null): Promise<Response> {
		const workspace = await getWorkspace(workspaceId);
		const now = new Date();
		const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const tomorrow = new Date(todayStart.getTime() + 86_400_000);

		const [monthRuns, todayRuns, threadRows] = await Promise.all([
			prisma.agentRun.findMany({
				where: { workspaceId: workspace.id, createdAt: { gte: monthStart } },
				select: {
					costCents: true,
					inputTokens: true,
					outputTokens: true,
					triggerType: true,
					createdAt: true,
				},
			}),
			prisma.agentRun.findMany({
				where: { workspaceId: workspace.id, createdAt: { gte: todayStart, lt: tomorrow } },
				select: { costCents: true },
			}),
			prisma.agentRun.findMany({
				where: {
					workspaceId: workspace.id,
					createdAt: { gte: monthStart },
					threadId: { not: null },
				},
				select: {
					costCents: true,
					inputTokens: true,
					outputTokens: true,
					thread: {
						select: { id: true, title: true, slackChannel: true, createdAt: true },
					},
				},
			}),
		]);

		const totalCost = monthRuns.reduce((sum, r) => sum + r.costCents, 0);
		const todayCost = todayRuns.reduce((sum, r) => sum + r.costCents, 0);
		const totalInputTokens = monthRuns.reduce((sum, r) => sum + r.inputTokens, 0);
		const totalOutputTokens = monthRuns.reduce((sum, r) => sum + r.outputTokens, 0);
		const daysElapsed = Math.max(
			1,
			Math.floor((now.getTime() - monthStart.getTime()) / 86_400_000) + 1,
		);
		const avgPerDay = totalCost / daysElapsed;

		const stats = [
			{ label: "Total Cost", value: formatCost(totalCost) },
			{ label: "Today", value: formatCost(todayCost) },
			{ label: "Avg / Day", value: formatCost(avgPerDay) },
			{ label: "Tokens", value: formatTokens(totalInputTokens + totalOutputTokens) },
		];

		const dailyMap = new Map<number, { oneOff: number; scheduled: number }>();
		for (const run of monthRuns) {
			const day = run.createdAt.getDate();
			const entry = dailyMap.get(day) ?? { oneOff: 0, scheduled: 0 };
			if (SCHEDULED_TRIGGER_TYPES.includes(run.triggerType)) {
				entry.scheduled += run.costCents / 100;
			} else {
				entry.oneOff += run.costCents / 100;
			}
			dailyMap.set(day, entry);
		}
		const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
		const chartData = Array.from({ length: Math.min(now.getDate(), daysInMonth) }, (_, i) => {
			const day = i + 1;
			const entry = dailyMap.get(day) ?? { oneOff: 0, scheduled: 0 };
			return { day, oneOff: entry.oneOff, scheduled: entry.scheduled };
		});

		const threadCostMap = new Map<
			string,
			{
				title: string;
				createdAt: Date;
				total: number;
				inputTokens: number;
				outputTokens: number;
			}
		>();
		for (const run of threadRows) {
			if (!run.thread) continue;
			const { id, title, slackChannel, createdAt } = run.thread;
			const displayTitle = title ?? `Slack: ${slackChannel}`;
			const existing = threadCostMap.get(id);
			if (existing) {
				existing.total += run.costCents;
				existing.inputTokens += run.inputTokens;
				existing.outputTokens += run.outputTokens;
			} else {
				threadCostMap.set(id, {
					title: displayTitle,
					createdAt,
					total: run.costCents,
					inputTokens: run.inputTokens,
					outputTokens: run.outputTokens,
				});
			}
		}
		const threads = Array.from(threadCostMap.values())
			.sort((a, b) => b.total - a.total)
			.slice(0, 10)
			.map((t) => ({
				title: t.title,
				created: t.createdAt.toLocaleDateString("en-US", {
					month: "short",
					day: "numeric",
					year: "numeric",
				}),
				cost: t.total,
				inputTokens: t.inputTokens,
				outputTokens: t.outputTokens,
			}));

		return Response.json({ stats, chartData, threads });
	}

	async function handleTasks(workspaceId: string | null): Promise<Response> {
		const workspace = await getWorkspace(workspaceId);
		const cronJobs = await prisma.cronJob.findMany({
			where: { workspaceId: workspace.id },
			orderBy: { createdAt: "desc" },
		});

		const tasks = cronJobs.map((job) => ({
			id: job.id,
			name: job.name,
			schedule: job.schedule,
			description: job.description,
			enabled: job.enabled,
			type: job.type,
			createdAgo: formatRelativeTime(job.createdAt),
		}));

		return Response.json({ tasks });
	}

	async function handleTeam(workspaceId: string | null): Promise<Response> {
		const workspace = await prisma.workspace.findFirst({
			where: workspaceId ? { id: workspaceId } : { isActive: true },
			include: { members: true },
		});
		if (!workspace) {
			return Response.json({ error: "No workspace found" }, { status: 404 });
		}

		const settings = workspace.settings as Record<string, unknown>;
		const members = workspace.members.map((m) => ({
			id: m.id,
			displayName: m.displayName ?? m.slackUserId,
			slackUserId: m.slackUserId,
			initials: getInitials(m.displayName ?? m.slackUserId),
			createdAt: m.createdAt.toISOString(),
		}));

		return Response.json({
			teamName: workspace.slackTeamName,
			seatCount: workspace.members.length,
			members,
			allowBotInvite: settings.allowBotInvite !== false,
		});
	}

	async function handleGetSettings(workspaceId: string | null): Promise<Response> {
		const workspace = await getWorkspace(workspaceId);
		const settings = workspace.settings as Record<string, unknown>;
		return Response.json({
			defaultModel: (settings.defaultModel as string) ?? "claude-opus-4-6",
		});
	}

	async function handleUpdateModel(req: Request, workspaceId: string | null): Promise<Response> {
		const { model } = (await req.json()) as { model: string };
		if (!model) {
			return Response.json({ error: "model is required" }, { status: 400 });
		}
		const workspace = await getWorkspace(workspaceId);
		const settings = (workspace.settings as Record<string, unknown>) ?? {};
		await prisma.workspace.update({
			where: { id: workspace.id },
			data: { settings: { ...settings, defaultModel: model } },
		});
		return Response.json({ success: true });
	}

	async function handleHealth(): Promise<Response> {
		let dbOk = false;
		try {
			await prisma.$queryRaw`SELECT 1`;
			dbOk = true;
		} catch {
			/* noop */
		}

		return Response.json({
			status: dbOk ? "healthy" : "degraded",
			deploymentMode: config.DEPLOYMENT_MODE,
			connectedWorkspaces: connectionManager?.connectedCount ?? 0,
			database: dbOk ? "connected" : "disconnected",
		});
	}

	return {
		fetch: async (req: Request): Promise<Response> => {
			const url = new URL(req.url, "http://localhost");
			const { pathname } = url;

			try {
				// Public endpoints (no auth required)
				if (req.method === "GET" && pathname === "/api/health") {
					return await handleHealth();
				}
				if (req.method === "POST" && pathname === "/api/auth/login") {
					return await auth.handleLogin(req);
				}

				// Authenticate all other /api/* routes
				const authCtx = await auth.authenticate(req);
				if (!authCtx) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				const workspaceId = auth.resolveWorkspaceId(req, authCtx);

				if (req.method === "GET" && pathname === "/api/workspaces")
					return await handleWorkspaces(authCtx);
				if (req.method === "GET" && pathname === "/api/workspace")
					return await handleWorkspace(workspaceId);
				if (req.method === "GET" && pathname === "/api/integrations")
					return await handleIntegrations(workspaceId);
				if (req.method === "POST" && pathname === "/api/integrations/connect")
					return await handleConnect(req, workspaceId);
				if (req.method === "POST" && pathname === "/api/integrations/disconnect")
					return await handleDisconnect(req, workspaceId);
				if (req.method === "GET" && pathname === "/api/usage")
					return await handleUsage(workspaceId);
				if (req.method === "GET" && pathname === "/api/tasks")
					return await handleTasks(workspaceId);
				if (req.method === "GET" && pathname === "/api/team") return await handleTeam(workspaceId);
				if (req.method === "GET" && pathname === "/api/settings")
					return await handleGetSettings(workspaceId);
				if (req.method === "PUT" && pathname === "/api/settings/model")
					return await handleUpdateModel(req, workspaceId);

				return Response.json({ error: "Not found" }, { status: 404 });
			} catch (err) {
				logger.error({ err, pathname }, "Dashboard API error");
				const message = err instanceof Error ? err.message : "Internal server error";
				return Response.json({ error: message }, { status: 500 });
			}
		},
	};
}
