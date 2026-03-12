import { createLogger, loadConfig } from "@openviktor/shared";
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

	const app = createSlackApp(config);

	app.use(createDeduplicator());
	app.use(createBotFilter());

	registerEventHandlers(app, logger);

	await startSlackApp(app);

	process.on("SIGTERM", async () => {
		logger.info("SIGTERM received, shutting down");
		await app.stop();
		process.exit(0);
	});

	process.on("SIGINT", async () => {
		logger.info("SIGINT received, shutting down");
		await app.stop();
		process.exit(0);
	});
}

main().catch((err) => {
	logger.error({ err }, "Fatal error during startup");
	process.exit(1);
});
