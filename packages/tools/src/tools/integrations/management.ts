import type { PrismaClient } from "@openviktor/db";
import type { PipedreamClient } from "@openviktor/integrations";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../../registry.js";

export const listAvailableIntegrationsDefinition: LLMToolDefinition = {
	name: "list_available_integrations",
	description:
		"Search Pipedream's catalog of 3,000+ apps. Returns name, slug, auth type, and description. Use to help users find integrations to connect.",
	input_schema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Search query (e.g., 'google sheets', 'slack', 'github')",
			},
			limit: {
				type: "integer",
				description: "Max results (default 20)",
			},
		},
		required: ["query"],
	},
};

export const listWorkspaceConnectionsDefinition: LLMToolDefinition = {
	name: "list_workspace_connections",
	description: "List all connected integration accounts for this workspace with their status.",
	input_schema: {
		type: "object",
		properties: {},
		required: [],
	},
};

export const connectIntegrationDefinition: LLMToolDefinition = {
	name: "connect_integration",
	description:
		"Generate a Pipedream Connect Link for an app. Posts the link to Slack so the user can authorize. After the user completes authorization, call sync_workspace_connections to register the new tools.",
	input_schema: {
		type: "object",
		properties: {
			app_slug: {
				type: "string",
				description: "The app slug from list_available_integrations (e.g., 'google_sheets')",
			},
		},
		required: ["app_slug"],
	},
};

export const disconnectIntegrationDefinition: LLMToolDefinition = {
	name: "disconnect_integration",
	description:
		"Disconnect an integration account from this workspace. Removes all associated tools.",
	input_schema: {
		type: "object",
		properties: {
			app_slug: {
				type: "string",
				description: "The app slug to disconnect (e.g., 'google_sheets')",
			},
		},
		required: ["app_slug"],
	},
};

export const syncWorkspaceConnectionsDefinition: LLMToolDefinition = {
	name: "sync_workspace_connections",
	description:
		"Force-sync connections from Pipedream. Detects new connections and registers their tools. Call after a user completes OAuth via a connect link.",
	input_schema: {
		type: "object",
		properties: {},
		required: [],
	},
};

export interface IntegrationSyncHandler {
	syncWorkspace(workspaceId: string): Promise<{ added: string[]; removed: string[] }>;
	disconnectApp(workspaceId: string, appSlug: string): Promise<{ removed: string[] }>;
}

export function createListAvailableIntegrationsExecutor(client: PipedreamClient): ToolExecutor {
	return async (args) => {
		const query = args.query as string;
		const limit = typeof args.limit === "number" ? args.limit : 20;

		const apps = await client.listApps({ q: query, hasActions: true, limit });

		if (apps.length === 0) {
			return {
				output: `No integrations found for "${query}". Try a different search term.`,
				durationMs: 0,
			};
		}

		const results = apps.map((app) => ({
			slug: app.name_slug,
			name: app.name,
			auth_type: app.auth_type ?? "unknown",
			description: app.description ?? "",
		}));

		return { output: { results, count: results.length }, durationMs: 0 };
	};
}

export function createListWorkspaceConnectionsExecutor(prisma: PrismaClient): ToolExecutor {
	return async (_args, ctx) => {
		const accounts = await prisma.integrationAccount.findMany({
			where: { workspaceId: ctx.workspaceId, status: "ACTIVE" },
			select: {
				appSlug: true,
				appName: true,
				provider: true,
				connectedAt: true,
			},
			orderBy: { connectedAt: "desc" },
		});

		if (accounts.length === 0) {
			return {
				output:
					"No integrations connected yet. Use list_available_integrations to search for apps, then connect_integration to connect one.",
				durationMs: 0,
			};
		}

		const connections = accounts.map((a) => ({
			app_slug: a.appSlug,
			app_name: a.appName,
			provider: a.provider,
			connected_at: a.connectedAt.toISOString(),
		}));

		return { output: { connections, count: connections.length }, durationMs: 0 };
	};
}

export function createConnectIntegrationExecutor(
	client: PipedreamClient,
	onLinkGenerated?: (workspaceId: string, appSlug: string) => void,
): ToolExecutor {
	return async (args, ctx) => {
		const appSlug = args.app_slug as string;
		if (!appSlug || appSlug.trim().length === 0) {
			return { output: null, durationMs: 0, error: "app_slug is required" };
		}

		const externalUserId = `workspace_${ctx.workspaceId}`;
		const connectToken = await client.createConnectToken(externalUserId);

		const separator = connectToken.connect_link_url.includes("?") ? "&" : "?";
		const connectLink = `${connectToken.connect_link_url}${separator}app=${encodeURIComponent(appSlug)}`;

		onLinkGenerated?.(ctx.workspaceId, appSlug);

		return {
			output: {
				connect_link: connectLink,
				expires_at: connectToken.expires_at,
				message: `Share this link with the user to authorize ${appSlug}. The connection will be detected automatically once you complete authorization.`,
			},
			durationMs: 0,
		};
	};
}

export function createDisconnectIntegrationExecutor(
	syncHandler: IntegrationSyncHandler,
): ToolExecutor {
	return async (args, ctx) => {
		const appSlug = args.app_slug as string;
		if (!appSlug || appSlug.trim().length === 0) {
			return { output: null, durationMs: 0, error: "app_slug is required" };
		}

		const result = await syncHandler.disconnectApp(ctx.workspaceId, appSlug);
		return {
			output: {
				disconnected: appSlug,
				tools_removed: result.removed,
				message: `Disconnected ${appSlug}. Removed ${result.removed.length} tools.`,
			},
			durationMs: 0,
		};
	};
}

export function createSyncWorkspaceConnectionsExecutor(
	syncHandler: IntegrationSyncHandler,
): ToolExecutor {
	return async (_args, ctx) => {
		const result = await syncHandler.syncWorkspace(ctx.workspaceId);
		return {
			output: {
				added: result.added,
				removed: result.removed,
				message:
					result.added.length > 0
						? `Synced! Added ${result.added.length} integration(s): ${result.added.join(", ")}. ${result.removed.length} removed.`
						: result.removed.length > 0
							? `Synced! Removed ${result.removed.length} integration(s): ${result.removed.join(", ")}.`
							: "No changes detected. All connections are up to date.",
			},
			durationMs: 0,
		};
	};
}
