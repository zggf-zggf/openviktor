import { prisma } from "@openviktor/db";
import { createLogger, loadConfig } from "@openviktor/shared";
import {
	LocalToolBackend,
	ModalToolBackend,
	ToolGatewayClient,
	createNativeRegistry,
	registerDbTools,
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
	startSlackApp,
} from "./slack/index.js";
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
		{ port: gatewayServer.port, tools: registry.getDefinitions().map((t) => t.name) },
		"Tool gateway started",
	);

	const gatewayClient = new ToolGatewayClient({
		baseUrl: `http://localhost:${gatewayServer.port}`,
		token: "local",
		timeoutMs: config.TOOL_TIMEOUT_MS,
	});
	registerWorkspaceToken("local", "default");

	const llm = new LLMGateway(config);
	const runner = new AgentRunner(prisma, llm, createLogger("agent-runner"), {
		client: gatewayClient,
		tools: registry.getDefinitions(),
	});

	// ─── Cron Scheduler ────────────────────────────────────
	const scheduler = new CronScheduler(prisma, runner, createLogger("cron-scheduler"), {
		checkIntervalMs: config.CRON_CHECK_INTERVAL_MS,
		heartbeatEnabled: config.HEARTBEAT_ENABLED,
		slackToken: config.SLACK_BOT_TOKEN,
		defaultModel: config.DEFAULT_MODEL,
	});

	// Register cron CRUD tools
	const cronTools = createCronToolExecutors(prisma, scheduler);
	registry.register("create_cron_job", createCronJobDefinition, cronTools.create_cron_job);
	registry.register("delete_cron_job", deleteCronJobDefinition, cronTools.delete_cron_job);
	registry.register("trigger_cron_job", triggerCronJobDefinition, cronTools.trigger_cron_job);
	registry.register("list_cron_jobs", listCronJobsDefinition, cronTools.list_cron_jobs);

	// Update runner's tool list to include cron tools
	runner.updateToolConfig({
		client: gatewayClient,
		tools: registry.getDefinitions(),
	});

	scheduler.start();

	const app = createSlackApp(config);

	app.use(createDeduplicator());
	app.use(createBotFilter(logger));

	registerEventHandlers(app, { prisma, runner, logger });

	await startSlackApp(app);

	const shutdown = async () => {
		logger.info("Shutting down");
		scheduler.stop();
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
