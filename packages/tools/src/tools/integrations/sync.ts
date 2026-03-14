import type { PrismaClient } from "@openviktor/db";
import type { PipedreamClient } from "@openviktor/integrations";
import type { ToolRegistry } from "../../registry.js";
import type { IntegrationSyncHandler } from "./management.js";
import { registerIntegrationTools, unregisterIntegrationTools } from "./pipedream-tools.js";

interface SyncDeps {
	registry: ToolRegistry;
	client: PipedreamClient;
	prisma: PrismaClient;
	skipPermissions: boolean;
}

async function syncNewOrMissingAccount(
	deps: SyncDeps,
	workspaceId: string,
	externalUserId: string,
	remote: { id: string; app?: { name_slug?: string; name?: string } },
	existingAccount: { id: string; appSlug: string; appName: string } | null,
): Promise<string | null> {
	const appSlug = remote.app?.name_slug;
	const appName = remote.app?.name;
	if (!appSlug || !appName) return null;

	let accountId: string;
	if (existingAccount) {
		accountId = existingAccount.id;
	} else {
		const created = await deps.prisma.integrationAccount.create({
			data: {
				workspaceId,
				provider: "pipedream",
				appSlug,
				appName,
				authProvisionId: remote.id,
				externalUserId,
			},
		});
		accountId = created.id;
	}

	const actions = await deps.client.listActions({ app: appSlug, limit: 50 });
	if (existingAccount && actions.length === 0) return null;

	await registerIntegrationTools(
		deps.registry,
		deps.client,
		deps.prisma,
		{ id: accountId, workspaceId, appSlug, appName, authProvisionId: remote.id, externalUserId },
		actions,
		deps.skipPermissions,
	);

	return appSlug;
}

async function needsToolReregistration(
	deps: SyncDeps,
	workspaceId: string,
	appSlug: string,
): Promise<boolean> {
	const toolCount = await deps.prisma.toolDefinition.count({
		where: { workspaceId, type: "PIPEDREAM", name: { startsWith: `mcp_pd_${appSlug}_` } },
	});
	return toolCount === 0 || !deps.registry.resolve(`mcp_pd_${appSlug}_configure`, workspaceId);
}

function shouldSkipRemote(
	remote: { id: string; app?: { name_slug?: string } },
	existingSlugs: Set<string>,
): boolean {
	return !remote.app?.name_slug || (existingSlugs.has(remote.id) && false);
}

async function syncAddedAccounts(
	deps: SyncDeps,
	workspaceId: string,
	remoteAccounts: { id: string; app?: { name_slug?: string; name?: string } }[],
	existingAccounts: { id: string; appSlug: string; appName: string; authProvisionId: string }[],
): Promise<string[]> {
	const existingSlugs = new Set(existingAccounts.map((a) => a.authProvisionId));
	const externalUserId = `workspace_${workspaceId}`;
	const added: string[] = [];

	for (const remote of remoteAccounts) {
		if (!remote.app?.name_slug) continue;

		const existing = existingAccounts.find((a) => a.authProvisionId === remote.id) ?? null;

		if (existing && !(await needsToolReregistration(deps, workspaceId, existing.appSlug))) continue;

		const slug = await syncNewOrMissingAccount(deps, workspaceId, externalUserId, remote, existing);
		if (slug) added.push(slug);
	}

	return added;
}

async function syncRemovedAccounts(
	deps: SyncDeps,
	workspaceId: string,
	remoteAccounts: { id: string }[],
	existingAccounts: { id: string; appSlug: string; authProvisionId: string }[],
): Promise<string[]> {
	const remoteProvisionIds = new Set(remoteAccounts.map((r) => r.id));
	const removed: string[] = [];

	for (const existing of existingAccounts) {
		if (remoteProvisionIds.has(existing.authProvisionId)) continue;

		await deps.prisma.integrationAccount.update({
			where: { id: existing.id },
			data: { status: "REVOKED" },
		});

		const removedTools = await unregisterIntegrationTools(
			deps.registry,
			deps.prisma,
			workspaceId,
			existing.appSlug,
		);
		if (removedTools.length > 0) {
			removed.push(existing.appSlug);
		}
	}

	return removed;
}

export function createIntegrationSyncHandler(
	registry: ToolRegistry,
	client: PipedreamClient,
	prisma: PrismaClient,
	skipPermissions: boolean,
): IntegrationSyncHandler {
	const deps: SyncDeps = { registry, client, prisma, skipPermissions };

	return {
		async syncWorkspace(workspaceId: string) {
			const remoteAccounts = await client.listAccounts(`workspace_${workspaceId}`);
			const existingAccounts = await prisma.integrationAccount.findMany({
				where: { workspaceId, status: "ACTIVE" },
			});

			const added = await syncAddedAccounts(deps, workspaceId, remoteAccounts, existingAccounts);
			const removed = await syncRemovedAccounts(
				deps,
				workspaceId,
				remoteAccounts,
				existingAccounts,
			);

			return { added, removed };
		},

		async disconnectApp(workspaceId: string, appSlug: string) {
			const accounts = await prisma.integrationAccount.findMany({
				where: { workspaceId, appSlug, status: "ACTIVE" },
			});

			for (const account of accounts) {
				try {
					await client.deleteAccount(account.authProvisionId);
				} catch {
					// Account may already be removed on Pipedream side
				}
				await prisma.integrationAccount.update({
					where: { id: account.id },
					data: { status: "REVOKED" },
				});
			}

			const removed = await unregisterIntegrationTools(registry, prisma, workspaceId, appSlug);
			return { removed };
		},
	};
}
