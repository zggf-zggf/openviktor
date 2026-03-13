import { prisma } from "@openviktor/db";
import { createLogger, loadConfig } from "@openviktor/shared";
import { LLMGateway } from "./agent/gateway.js";
import { AgentRunner } from "./agent/runner.js";
import {
	createBotFilter,
	createDeduplicator,
	createSlackApp,
	registerEventHandlers,
	startSlackApp,
} from "./slack/index.js";

const logger = createLogger("bot");

async function main(): Promise<void> {
	const config = loadConfig();

	await prisma.$connect();
	logger.info("Database connected");

	const llm = new LLMGateway(config);
	const runner = new AgentRunner(prisma, llm, createLogger("agent-runner"));

	const app = createSlackApp(config);

	app.use(createDeduplicator());
	app.use(createBotFilter());

	registerEventHandlers(app, { prisma, runner, logger });

	await startSlackApp(app);

	const shutdown = async () => {
		logger.info("Shutting down");
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
