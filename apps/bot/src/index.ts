import { prisma } from "@openviktor/db";
import { PipedreamClient } from "@openviktor/integrations";
import type { PipedreamConfig } from "@openviktor/integrations";
import { createLogger, loadConfig } from "@openviktor/shared";
import {
	LocalToolBackend,
	ModalToolBackend,
	ToolGatewayClient,
	connectIntegrationDefinition,
	createConnectIntegrationExecutor,
	createDisconnectIntegrationExecutor,
	createIntegrationSyncHandler,
	createListAvailableIntegrationsExecutor,
	createListWorkspaceConnectionsExecutor,
	createNativeRegistry,
	createSubmitPermissionRequestExecutor,
	createSyncWorkspaceConnectionsExecutor,
	disconnectIntegrationDefinition,
	listAvailableIntegrationsDefinition,
	listWorkspaceConnectionsDefinition,
	registerDbTools,
	restoreToolsFromDb,
	submitPermissionRequestDefinition,
	syncWorkspaceConnectionsDefinition,
} from "@openviktor/tools";
import type { RegistryConfig, ToolBackend } from "@openviktor/tools";
import { LLMGateway } from "./agent/gateway.js";
import { AnthropicProvider } from "./agent/providers/anthropic.js";
import { AgentRunner } from "./agent/runner.js";
import {
	CronScheduler,
	createCronJobDefinition,
	createCronToolExecutors,
	deleteCronJobDefinition,
	listCronJobsDefinition,
	triggerCronJobDefinition,
} from "./cron/index.js";
import {
	createBotFilter,
	createDeduplicator,
	createSlackApp,
	registerEventHandlers,
	registerInteractionHandlers,
	startSlackApp,
} from "./slack/index.js";
import { createConcurrencyLimiter } from "./thread/concurrency.js";
import { ThreadLock } from "./thread/lock.js";
import { StaleThreadDetector } from "./thread/stale.js";
import { IntegrationWatcher } from "./integrations/watcher.js";
import { createToolGateway, registerWorkspaceToken } from "./tool-gateway/server.js";

const logger = createLogger("bot");

function createToolBackend(config: ReturnType<typeof loadConfig>): {
	backend: ToolBackend;
	registry: ReturnType<typeof createNativeRegistry>;
} {
	const llmProvider = new AnthropicProvider(config.ANTHROPIC_API_KEY);
	const registryConfig: RegistryConfig = {
		slackToken: config.SLACK_BOT_TOKEN,
		githubToken: config.GITHUB_TOKEN,
		browserbaseApiKey: config.BROWSERBASE_API_KEY,
		context7BaseUrl: config.CONTEXT7_BASE_URL,
		searchApiKey: config.SEARCH_API_KEY,
		imagenApiKey: config.IMAGEN_API_KEY,
		llmProvider,
		defaultModel: config.DEFAULT_MODEL,
	};
	const registry = createNativeRegistry(registryConfig);
	registerDbTools(registry, prisma);

	if (config.TOOL_BACKEND === "modal") {
		// MODAL_ENDPOINT_URL is validated as required by the config schema
		const backend = new ModalToolBackend({
			endpointUrl: config.MODAL_ENDPOINT_URL as string,
			authToken: config.MODAL_AUTH_TOKEN,
			timeoutMs: config.TOOL_TIMEOUT_MS,
		});
		logger.info({ endpoint: config.MODAL_ENDPOINT_URL }, "Using Modal tool backend");
		return { backend, registry };
	}

	const backend = new LocalToolBackend(registry);
	logger.info("Using local tool backend");
	return { backend, registry };
}

async function main(): Promise<void> {
	const config = loadConfig();

	await prisma.$connect();
	logger.info("Database connected");

	const { backend, registry } = createToolBackend(config);
	const gatewayDeps = {
		registry,
		backend,
		logger: createLogger("tool-gateway"),
		defaultTimeoutMs: config.TOOL_TIMEOUT_MS,
	};
	const gateway = createToolGateway(gatewayDeps);

	const gatewayPort = config.TOOL_GATEWAY_PORT;
	const gatewayServer = Bun.serve({
		port: gatewayPort,
		fetch: gateway.fetch,
	});
	logger.info(
		{ port: gatewayServer.port, tools: registry.getAllDefinitions().map((t) => t.name) },
		"Tool gateway started",
	);

	const gatewayClient = new ToolGatewayClient({
		baseUrl: `http://localhost:${gatewayServer.port}`,
		token: "local",
		timeoutMs: config.TOOL_TIMEOUT_MS,
	});
	registerWorkspaceToken("local", "default");

	const concurrencyLimiter = await createConcurrencyLimiter(
		config.MAX_CONCURRENT_RUNS,
		createLogger("concurrency"),
		config.REDIS_URL,
		config.AGENT_TIMEOUT_MS,
	);

	const threadLock = new ThreadLock(
		prisma,
		createLogger("thread-lock"),
		config.THREAD_LOCK_TIMEOUT_MS,
	);

	const staleDetector = new StaleThreadDetector(
		prisma,
		createLogger("stale-detector"),
		config.STALE_THREAD_TIMEOUT_MS,
		config.STALE_CHECK_INTERVAL_MS,
	);
	staleDetector.start();

	const llm = new LLMGateway(config);
	const runner = new AgentRunner(
		prisma,
		llm,
		createLogger("agent-runner"),
		{
			client: gatewayClient,
			tools: registry.getDefinitions(),
		},
		{
			concurrencyLimiter,
			threadLock,
			maxConcurrentRuns: config.MAX_CONCURRENT_RUNS,
		},
	);

	const scheduler = new CronScheduler(prisma, runner, createLogger("cron-scheduler"), {
		checkIntervalMs: config.CRON_CHECK_INTERVAL_MS,
		heartbeatEnabled: config.HEARTBEAT_ENABLED,
		slackToken: config.SLACK_BOT_TOKEN,
		defaultModel: config.DEFAULT_MODEL,
	});

	const cronTools = createCronToolExecutors(prisma, scheduler);
	const local = { localOnly: true };
	registry.register("create_cron_job", createCronJobDefinition, cronTools.create_cron_job, local);
	registry.register("delete_cron_job", deleteCronJobDefinition, cronTools.delete_cron_job, local);
	registry.register("trigger_cron_job", triggerCronJobDefinition, cronTools.trigger_cron_job, local);
	registry.register("list_cron_jobs", listCronJobsDefinition, cronTools.list_cron_jobs, local);

	// Pipedream integration tools
	let integrationWatcher: IntegrationWatcher | undefined;
	const hasPipedream = !!(
		config.PIPEDREAM_CLIENT_ID &&
		config.PIPEDREAM_CLIENT_SECRET &&
		config.PIPEDREAM_PROJECT_ID
	);
	if (hasPipedream) {
		const pdConfig: PipedreamConfig = {
			clientId: config.PIPEDREAM_CLIENT_ID as string,
			clientSecret: config.PIPEDREAM_CLIENT_SECRET as string,
			projectId: config.PIPEDREAM_PROJECT_ID as string,
			environment: config.PIPEDREAM_ENVIRONMENT,
		};
		const pdClient = new PipedreamClient(pdConfig);
		const skipPermissions = config.DANGEROUSLY_SKIP_PERMISSIONS;

		const syncHandler = createIntegrationSyncHandler(registry, pdClient, prisma, skipPermissions);

		const refreshRunnerTools = () => {
			runner.updateToolConfig({
				client: gatewayClient,
				tools: registry.getDefinitions(),
			});
		};

		integrationWatcher = new IntegrationWatcher(
			pdClient,
			syncHandler,
			refreshRunnerTools,
			createLogger("integration-watcher"),
		);

		registry.register(
			"list_available_integrations",
			listAvailableIntegrationsDefinition,
			createListAvailableIntegrationsExecutor(pdClient),
			local,
		);
		registry.register(
			"list_workspace_connections",
			listWorkspaceConnectionsDefinition,
			createListWorkspaceConnectionsExecutor(prisma),
			local,
		);
		registry.register(
			"connect_integration",
			connectIntegrationDefinition,
			createConnectIntegrationExecutor(pdClient, (workspaceId, appSlug) => {
				integrationWatcher!.watch(workspaceId, appSlug);
			}),
			local,
		);
		registry.register(
			"disconnect_integration",
			disconnectIntegrationDefinition,
			createDisconnectIntegrationExecutor(syncHandler),
			local,
		);
		registry.register(
			"sync_workspace_connections",
			syncWorkspaceConnectionsDefinition,
			createSyncWorkspaceConnectionsExecutor(syncHandler),
			local,
		);
		registry.register(
			"submit_permission_request",
			submitPermissionRequestDefinition,
			createSubmitPermissionRequestExecutor(prisma),
			local,
		);

		// Restore dynamic tools from DB (restart resilience)
		const restored = await restoreToolsFromDb(registry, pdClient, prisma, skipPermissions);
		if (restored.length > 0) {
			logger.info({ count: restored.length }, "Restored Pipedream tools from database");
		}

		logger.info("Pipedream integration enabled");
	} else {
		logger.info("Pipedream integration disabled (no credentials configured)");
	}

	runner.updateToolConfig({
		client: gatewayClient,
		tools: registry.getDefinitions(),
	});

	scheduler.start();

	const app = createSlackApp(config);

	app.use(createDeduplicator());
	app.use(createBotFilter(logger));

	registerEventHandlers(app, { prisma, runner, logger });
	registerInteractionHandlers(app, { prisma, logger: createLogger("interactions") });

	await startSlackApp(app);

	const shutdown = async () => {
		logger.info("Shutting down");
		integrationWatcher?.stop();
		staleDetector.stop();
		scheduler.stop();
		await concurrencyLimiter.shutdown();
		gatewayServer.stop();
		await app.stop();
		await prisma.$disconnect();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	logger.error({ err }, "Fatal error during startup");
	process.exit(1);
});
