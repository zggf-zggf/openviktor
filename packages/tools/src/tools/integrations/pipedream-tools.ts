import type { PrismaClient } from "@openviktor/db";
import type {
	PipedreamAction,
	PipedreamClient,
	PipedreamConfigurableProp,
} from "@openviktor/integrations";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../../registry.js";
import type { ToolRegistry } from "../../registry.js";
import { actionKeyToToolName, convertConfigurableProps } from "./schema-converter.js";

interface IntegrationAccountRow {
	id: string;
	workspaceId: string;
	appSlug: string;
	appName: string;
	authProvisionId: string;
	externalUserId: string;
}

export function createPipedreamActionExecutor(
	client: PipedreamClient,
	prisma: PrismaClient,
	account: IntegrationAccountRow,
	action: { id: string; key: string; appPropName?: string },
	skipPermissions: boolean,
): ToolExecutor {
	return async (args, ctx) => {
		if (!skipPermissions) {
			const permissionResult = await requestPermission(
				prisma,
				ctx.workspaceId,
				args._agentRunId as string | undefined,
				actionKeyToToolName(account.appSlug, action.key),
				args,
			);
			if (permissionResult) return permissionResult;
		}

		const configuredProps: Record<string, unknown> = { ...args };
		configuredProps._agentRunId = undefined;

		if (action.appPropName) {
			configuredProps[action.appPropName] = {
				authProvisionId: account.authProvisionId,
			};
		}

		const result = await client.runAction({
			actionId: action.id,
			externalUserId: account.externalUserId,
			configuredProps,
		});

		if (result.error) {
			return { output: null, durationMs: 0, error: result.error };
		}

		return { output: result.ret ?? result.exports ?? { success: true }, durationMs: 0 };
	};
}

export function createPipedreamConfigureExecutor(
	client: PipedreamClient,
	account: IntegrationAccountRow,
): ToolExecutor {
	return async (args) => {
		const actionKey = args.action as string;
		const propName = args.prop_name as string;

		if (!actionKey || !propName) {
			return { output: null, durationMs: 0, error: "Both action and prop_name are required" };
		}

		const result = await client.configure({
			actionKey,
			propName,
			externalUserId: account.externalUserId,
			configuredProps: (args.configured_props as Record<string, unknown>) ?? {},
		});

		return { output: result, durationMs: 0 };
	};
}

export function createPipedreamProxyExecutor(
	client: PipedreamClient,
	prisma: PrismaClient,
	account: IntegrationAccountRow,
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
	skipPermissions: boolean,
): ToolExecutor {
	return async (args, ctx) => {
		const requiresPermission = method !== "GET" && !skipPermissions;
		if (requiresPermission) {
			const toolName = `mcp_pd_${account.appSlug}_proxy_${method.toLowerCase()}`;
			const permissionResult = await requestPermission(
				prisma,
				ctx.workspaceId,
				args._agentRunId as string | undefined,
				toolName,
				args,
			);
			if (permissionResult) return permissionResult;
		}

		const url = args.url as string;
		if (!url) {
			return { output: null, durationMs: 0, error: "url is required" };
		}

		const result = await client.proxyRequest({
			app: account.appSlug,
			method,
			url,
			externalUserId: account.externalUserId,
			authProvisionId: account.authProvisionId,
			body: args.body as unknown,
			headers: args.headers as Record<string, string> | undefined,
		});

		return { output: result, durationMs: 0 };
	};
}

async function requestPermission(
	prisma: PrismaClient,
	workspaceId: string,
	agentRunId: string | undefined,
	toolName: string,
	toolInput: Record<string, unknown>,
): Promise<{ output: unknown; durationMs: number; error?: string } | null> {
	if (!agentRunId) return null;

	const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
	const approvalCode = crypto.randomUUID();

	const request = await prisma.permissionRequest.create({
		data: {
			workspaceId,
			agentRunId,
			toolName,
			toolInput: toolInput as object,
			approvalCode,
			expiresAt,
		},
	});

	const POLL_INTERVAL_MS = 2000;
	const MAX_WAIT_MS = 5 * 60 * 1000;
	const start = Date.now();

	while (Date.now() - start < MAX_WAIT_MS) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

		const updated = await prisma.permissionRequest.findUnique({
			where: { id: request.id },
		});

		if (!updated) {
			return {
				output: null,
				durationMs: Date.now() - start,
				error: "Permission request not found",
			};
		}

		if (updated.status === "APPROVED") {
			return null; // Proceed with execution
		}

		if (updated.status === "REJECTED") {
			return {
				output: null,
				durationMs: Date.now() - start,
				error: `Permission rejected by ${updated.approvedBy ?? "user"}`,
			};
		}

		if (updated.status === "EXPIRED" || new Date() >= updated.expiresAt) {
			await prisma.permissionRequest.updateMany({
				where: { id: request.id, status: "PENDING" },
				data: { status: "EXPIRED" },
			});
			return {
				output: null,
				durationMs: Date.now() - start,
				error: "Permission request timed out (5 min). Ask the user to approve and try again.",
			};
		}
	}

	return {
		output: null,
		durationMs: Date.now() - start,
		error: "Permission request timed out",
	};
}

function makeConfigureDefinition(appSlug: string, appName: string): LLMToolDefinition {
	return {
		name: `mcp_pd_${appSlug}_configure`,
		description: `Discover dynamic properties for ${appName} actions (e.g., available spreadsheet IDs, project names).`,
		input_schema: {
			type: "object",
			properties: {
				action: { type: "string", description: "The action key (from tool description)" },
				prop_name: { type: "string", description: "The property to resolve" },
				configured_props: {
					type: "object",
					description: "Already-configured properties for context (optional)",
				},
			},
			required: ["action", "prop_name"],
		},
	};
}

function makeProxyDefinition(appSlug: string, appName: string, method: string): LLMToolDefinition {
	const needsBody = method !== "GET" && method !== "DELETE";
	const properties: Record<string, unknown> = {
		url: { type: "string", description: `The API URL to ${method}` },
		headers: { type: "object", description: "Custom HTTP headers (optional)" },
	};
	const required = ["url"];

	if (needsBody) {
		properties.body = { type: "object", description: "Request body" };
	}

	return {
		name: `mcp_pd_${appSlug}_proxy_${method.toLowerCase()}`,
		description: `Raw HTTP ${method} request through ${appName}'s authenticated API proxy.`,
		input_schema: { type: "object", properties, required },
	};
}

export function generateSkillContent(
	appSlug: string,
	appName: string,
	actions: PipedreamAction[],
): string {
	const lines: string[] = ["---", `name: pd_${appSlug}`, "description: >"];

	const actionNames = actions
		.slice(0, 5)
		.map((a: PipedreamAction) => a.name)
		.join(", ");
	lines.push(`  ${actionNames} via ${appName}.`);
	lines.push("---");
	lines.push("");
	lines.push("## Available Tools");
	lines.push("");

	const toolSchemas: LLMToolDefinition[] = [];

	for (const action of actions) {
		const toolName = actionKeyToToolName(appSlug, action.key);
		lines.push(`### ${toolName}`);
		lines.push(action.description ?? action.name);

		const userProps = action.configurable_props.filter(
			(p: PipedreamConfigurableProp) => p.type !== "app",
		);
		if (userProps.length > 0) {
			const params = userProps
				.map((p) => `${p.name} (${p.type}${p.optional ? ", optional" : ""})`)
				.join(", ");
			lines.push(`Parameters: ${params}`);
		}
		lines.push("");

		toolSchemas.push({
			name: toolName,
			description: action.description ?? action.name,
			input_schema: convertConfigurableProps(action.configurable_props),
		});
	}

	const configureDef = makeConfigureDefinition(appSlug, appName);
	lines.push(`### ${configureDef.name}`);
	lines.push("Discover dynamic properties like available IDs and names.");
	lines.push("Parameters: action (string), prop_name (string)");
	lines.push("");
	toolSchemas.push(configureDef);

	for (const method of ["get", "post", "put", "patch", "delete"]) {
		const proxyDef = makeProxyDefinition(appSlug, appName, method.toUpperCase());
		lines.push(`### ${proxyDef.name}`);
		lines.push(`Raw HTTP ${method.toUpperCase()} request through ${appName} API auth.`);
		lines.push(
			`Parameters: url (string)${method !== "get" && method !== "delete" ? ", body (object, optional)" : ""}, headers (object, optional)`,
		);
		lines.push("");
		toolSchemas.push(proxyDef);
	}

	lines.push("---TOOL_SCHEMAS---");
	lines.push(JSON.stringify(toolSchemas));
	lines.push("---END_TOOL_SCHEMAS---");

	return lines.join("\n");
}

export function extractToolSchemas(skillContent: string): LLMToolDefinition[] | null {
	const startMarker = "---TOOL_SCHEMAS---\n";
	const endMarker = "\n---END_TOOL_SCHEMAS---";
	const startIdx = skillContent.indexOf(startMarker);
	const endIdx = skillContent.indexOf(endMarker);
	if (startIdx === -1 || endIdx === -1) return null;

	const json = skillContent.slice(startIdx + startMarker.length, endIdx);
	try {
		return JSON.parse(json) as LLMToolDefinition[];
	} catch {
		return null;
	}
}

export interface RegisteredIntegrationTools {
	toolNames: string[];
	skillDescription: string;
}

export async function registerIntegrationTools(
	registry: ToolRegistry,
	client: PipedreamClient,
	prisma: PrismaClient,
	account: IntegrationAccountRow,
	actions: PipedreamAction[],
	skipPermissions: boolean,
): Promise<RegisteredIntegrationTools> {
	const toolNames: string[] = [];

	for (const action of actions) {
		const toolName = actionKeyToToolName(account.appSlug, action.key);
		const inputSchema = convertConfigurableProps(action.configurable_props);
		const appPropName = action.configurable_props.find((p) => p.type === "app")?.name;

		const definition: LLMToolDefinition = {
			name: toolName,
			description: action.description ?? action.name,
			input_schema: inputSchema,
		};

		const executor = createPipedreamActionExecutor(
			client,
			prisma,
			account,
			{ id: action.id, key: action.key, appPropName },
			skipPermissions,
		);

		registry.registerScoped(account.workspaceId, toolName, definition, executor, {
			localOnly: true,
			discoverable: true,
		});
		toolNames.push(toolName);

		await prisma.toolDefinition.upsert({
			where: {
				workspaceId_name: { workspaceId: account.workspaceId, name: toolName },
			},
			update: {
				description: definition.description,
				schema: JSON.parse(JSON.stringify(inputSchema)),
				config: {
					actionId: action.id,
					actionKey: action.key,
					actionVersion: action.version,
					appSlug: account.appSlug,
					appPropName,
					authProvisionId: account.authProvisionId,
					externalUserId: account.externalUserId,
				},
			},
			create: {
				workspaceId: account.workspaceId,
				name: toolName,
				description: definition.description,
				type: "PIPEDREAM",
				schema: JSON.parse(JSON.stringify(inputSchema)),
				config: {
					actionId: action.id,
					actionKey: action.key,
					actionVersion: action.version,
					appSlug: account.appSlug,
					appPropName,
					authProvisionId: account.authProvisionId,
					externalUserId: account.externalUserId,
				},
			},
		});
	}

	// Configure tool
	const configureDef = makeConfigureDefinition(account.appSlug, account.appName);
	registry.registerScoped(
		account.workspaceId,
		configureDef.name,
		configureDef,
		createPipedreamConfigureExecutor(client, account),
		{ localOnly: true, discoverable: true },
	);
	toolNames.push(configureDef.name);

	// Proxy tools
	const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
	for (const method of methods) {
		const proxyDef = makeProxyDefinition(account.appSlug, account.appName, method);
		registry.registerScoped(
			account.workspaceId,
			proxyDef.name,
			proxyDef,
			createPipedreamProxyExecutor(client, prisma, account, method, skipPermissions),
			{ localOnly: true, discoverable: true },
		);
		toolNames.push(proxyDef.name);
	}

	// Generate SKILL.md and store it
	const skillContent = generateSkillContent(account.appSlug, account.appName, actions);
	const skillName = `pd_${account.appSlug}`;
	const actionNames = actions
		.slice(0, 5)
		.map((a) => a.name)
		.join(", ");
	const skillDescription = `${actionNames} via ${account.appName}`;

	await prisma.skill.upsert({
		where: {
			workspaceId_name: {
				workspaceId: account.workspaceId,
				name: skillName,
			},
		},
		update: { content: skillContent, description: skillDescription, version: { increment: 1 } },
		create: {
			workspaceId: account.workspaceId,
			name: skillName,
			description: skillDescription,
			content: skillContent,
		},
	});

	return { toolNames, skillDescription };
}

export async function unregisterIntegrationTools(
	registry: ToolRegistry,
	prisma: PrismaClient,
	workspaceId: string,
	appSlug: string,
): Promise<string[]> {
	const toolDefs = await prisma.toolDefinition.findMany({
		where: {
			workspaceId,
			type: "PIPEDREAM",
			name: { startsWith: `mcp_pd_${appSlug}_` },
		},
	});

	const removed: string[] = [];
	for (const td of toolDefs) {
		registry.unregisterScoped(workspaceId, td.name);
		removed.push(td.name);
	}

	// Also unregister configure + proxy tools (not in toolDefinition table)
	registry.unregisterScoped(workspaceId, `mcp_pd_${appSlug}_configure`);
	for (const method of ["get", "post", "put", "patch", "delete"]) {
		registry.unregisterScoped(workspaceId, `mcp_pd_${appSlug}_proxy_${method}`);
	}

	await prisma.toolDefinition.deleteMany({
		where: {
			workspaceId,
			type: "PIPEDREAM",
			name: { startsWith: `mcp_pd_${appSlug}_` },
		},
	});

	await prisma.skill.deleteMany({
		where: {
			workspaceId,
			name: `pd_${appSlug}`,
		},
	});

	return removed;
}

interface RestoreDeps {
	registry: ToolRegistry;
	client: PipedreamClient;
	prisma: PrismaClient;
	skipPermissions: boolean;
}

function restoreActionTool(
	deps: RestoreDeps,
	td: { workspaceId: string; name: string; description: string; config: unknown; schema: unknown },
): string | null {
	const config = td.config as Record<string, unknown>;
	const appSlug = config.appSlug as string;
	const actionId = config.actionId as string;
	const actionKey = config.actionKey as string;
	if (!appSlug || !actionId || !actionKey) return null;

	const account: IntegrationAccountRow = {
		id: "",
		workspaceId: td.workspaceId,
		appSlug,
		appName: appSlug,
		authProvisionId: (config.authProvisionId as string) ?? "",
		externalUserId: (config.externalUserId as string) ?? "",
	};

	const definition: LLMToolDefinition = {
		name: td.name,
		description: td.description,
		input_schema: td.schema as Record<string, unknown>,
	};

	const executor = createPipedreamActionExecutor(
		deps.client,
		deps.prisma,
		account,
		{ id: actionId, key: actionKey, appPropName: config.appPropName as string | undefined },
		deps.skipPermissions,
	);

	deps.registry.registerScoped(td.workspaceId, td.name, definition, executor, {
		localOnly: true,
		discoverable: true,
	});
	return td.name;
}

function restoreUtilityTools(deps: RestoreDeps, account: IntegrationAccountRow): string[] {
	const restored: string[] = [];

	const configureDef = makeConfigureDefinition(account.appSlug, account.appName);
	if (!deps.registry.resolve(configureDef.name, account.workspaceId)) {
		deps.registry.registerScoped(
			account.workspaceId,
			configureDef.name,
			configureDef,
			createPipedreamConfigureExecutor(deps.client, account),
			{ localOnly: true, discoverable: true },
		);
		restored.push(configureDef.name);
	}

	const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
	for (const method of methods) {
		const proxyDef = makeProxyDefinition(account.appSlug, account.appName, method);
		if (!deps.registry.resolve(proxyDef.name, account.workspaceId)) {
			deps.registry.registerScoped(
				account.workspaceId,
				proxyDef.name,
				proxyDef,
				createPipedreamProxyExecutor(
					deps.client,
					deps.prisma,
					account,
					method,
					deps.skipPermissions,
				),
				{ localOnly: true, discoverable: true },
			);
			restored.push(proxyDef.name);
		}
	}

	return restored;
}

export async function restoreToolsFromDb(
	registry: ToolRegistry,
	client: PipedreamClient,
	prisma: PrismaClient,
	skipPermissions: boolean,
): Promise<string[]> {
	const deps: RestoreDeps = { registry, client, prisma, skipPermissions };

	const toolDefs = await prisma.toolDefinition.findMany({
		where: { type: "PIPEDREAM", enabled: true },
	});

	const restored: string[] = [];

	for (const td of toolDefs) {
		const name = restoreActionTool(deps, td);
		if (name) restored.push(name);
	}

	// Restore configure + proxy tools per unique (workspace, app) pair
	const uniqueApps = new Map<string, IntegrationAccountRow>();
	for (const td of toolDefs) {
		const config = td.config as Record<string, unknown>;
		const appSlug = config.appSlug as string;
		const compositeKey = `${td.workspaceId}:${appSlug}`;
		if (!appSlug || uniqueApps.has(compositeKey)) continue;

		const accounts = await prisma.integrationAccount.findMany({
			where: { workspaceId: td.workspaceId, appSlug, status: "ACTIVE" },
			take: 1,
		});

		if (accounts.length > 0) {
			const acct = accounts[0];
			uniqueApps.set(compositeKey, {
				id: acct.id,
				workspaceId: acct.workspaceId,
				appSlug: acct.appSlug,
				appName: acct.appName,
				authProvisionId: acct.authProvisionId,
				externalUserId: acct.externalUserId,
			});
		}
	}

	for (const [, account] of uniqueApps) {
		restored.push(...restoreUtilityTools(deps, account));
	}

	return restored;
}
