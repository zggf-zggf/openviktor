import { describe, expect, it, vi } from "vitest";

vi.mock("@slack/bolt", () => {
	const App = vi.fn().mockImplementation(() => ({
		start: vi.fn().mockResolvedValue(undefined),
	}));
	const LogLevel = { INFO: "info", DEBUG: "debug", WARN: "warn", ERROR: "error" };
	return { App, LogLevel };
});

vi.mock("@openviktor/shared", () => ({
	createLogger: vi.fn().mockReturnValue({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

describe("createSlackApp", () => {
	it("creates App with correct config values", async () => {
		const { App } = await import("@slack/bolt");
		const { createSlackApp } = await import("./app.js");

		const config = {
			SLACK_BOT_TOKEN: "xoxb-test",
			SLACK_APP_TOKEN: "xapp-test",
			SLACK_SIGNING_SECRET: "secret-test",
		};

		createSlackApp(config as never);

		expect(App).toHaveBeenCalledOnce();
		const callArg = (App as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(callArg.token).toBe("xoxb-test");
		expect(callArg.appToken).toBe("xapp-test");
		expect(callArg.signingSecret).toBe("secret-test");
		expect(callArg.socketMode).toBe(true);
	});

	it("passes a logger adapter that delegates to pino", async () => {
		const { App } = await import("@slack/bolt");
		const { createLogger } = await import("@openviktor/shared");
		const { createSlackApp } = await import("./app.js");

		const pinoLogger = (createLogger as ReturnType<typeof vi.fn>).mock.results[0]?.value ?? {
			info: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};

		const config = {
			SLACK_BOT_TOKEN: "xoxb-test2",
			SLACK_APP_TOKEN: "xapp-test2",
			SLACK_SIGNING_SECRET: "secret-test2",
		};

		createSlackApp(config as never);

		const lastCall = (App as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
		const slackLogger = lastCall.logger;

		expect(slackLogger).toBeDefined();
		slackLogger.debug("d1", "d2");
		slackLogger.info("i1");
		slackLogger.warn("w1");
		slackLogger.error("e1");

		expect(pinoLogger.debug).toHaveBeenCalled();
		expect(pinoLogger.info).toHaveBeenCalled();
		expect(pinoLogger.warn).toHaveBeenCalled();
		expect(pinoLogger.error).toHaveBeenCalled();

		const { LogLevel } = await import("@slack/bolt");
		slackLogger.setLevel(LogLevel.DEBUG);
		expect(slackLogger.getLevel()).toBe(LogLevel.DEBUG);

		slackLogger.setName("test");
	});
});

describe("startSlackApp", () => {
	it("calls app.start()", async () => {
		const { startSlackApp } = await import("./app.js");

		const mockApp = { start: vi.fn().mockResolvedValue(undefined) };

		await startSlackApp(mockApp as never);

		expect(mockApp.start).toHaveBeenCalledOnce();
	});
});
