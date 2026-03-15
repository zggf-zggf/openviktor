import { createLogger } from "@openviktor/shared";
import type { EnvConfig, Logger } from "@openviktor/shared";
import { App, LogLevel } from "@slack/bolt";
import type { Logger as SlackLogger } from "@slack/bolt";

export function createSlackLoggerAdapter(pinoLogger: Logger): SlackLogger {
	let currentLevel = LogLevel.INFO;
	return {
		debug(...msg: unknown[]) {
			pinoLogger.debug(msg.join(" "));
		},
		info(...msg: unknown[]) {
			pinoLogger.info(msg.join(" "));
		},
		warn(...msg: unknown[]) {
			pinoLogger.warn(msg.join(" "));
		},
		error(...msg: unknown[]) {
			pinoLogger.error(msg.join(" "));
		},
		setLevel(level: LogLevel) {
			currentLevel = level;
		},
		getLevel() {
			return currentLevel;
		},
		setName(_name: string) {},
	};
}

export function createSlackApp(config: EnvConfig): App {
	const pinoLogger = createLogger("slack");
	const slackLogger = createSlackLoggerAdapter(pinoLogger);

	return new App({
		token: config.SLACK_BOT_TOKEN,
		appToken: config.SLACK_APP_TOKEN,
		signingSecret: config.SLACK_SIGNING_SECRET,
		socketMode: true,
		logger: slackLogger,
	});
}

export async function startSlackApp(app: App): Promise<void> {
	const logger = createLogger("slack");
	await app.start();
	logger.info("Slack app started in socket mode");
}
