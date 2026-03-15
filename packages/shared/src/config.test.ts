import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig, resetConfig } from "./config.js";

const validEnv = {
	SLACK_BOT_TOKEN: "xoxb-test-token",
	SLACK_APP_TOKEN: "xapp-test-token",
	SLACK_SIGNING_SECRET: "test-secret",
	ANTHROPIC_API_KEY: "sk-ant-test-key",
	DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
	DASHBOARD_PASSWORD: "test-password",
	LOG_LEVEL: "info",
	NODE_ENV: "test",
};

describe("loadConfig", () => {
	beforeEach(() => {
		resetConfig();
	});

	it("parses valid environment variables", () => {
		const config = loadConfig(validEnv);
		expect(config.SLACK_BOT_TOKEN).toBe("xoxb-test-token");
		expect(config.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");
		expect(config.DEFAULT_MODEL).toBe("claude-sonnet-4-20250514");
		expect(config.MAX_TOKENS).toBe(4096);
	});

	it("applies defaults for optional values", () => {
		const config = loadConfig(validEnv);
		expect(config.MAX_CONCURRENT_RUNS).toBe(16);
		expect(config.TOOL_TIMEOUT_MS).toBe(600_000);
		expect(config.AGENT_TIMEOUT_MS).toBe(300_000);
	});

	it("throws on missing required variables", () => {
		expect(() => loadConfig({})).toThrow("Invalid environment configuration");
	});

	it("throws on invalid SLACK_BOT_TOKEN prefix", () => {
		expect(() => loadConfig({ ...validEnv, SLACK_BOT_TOKEN: "invalid" })).toThrow(
			"Invalid environment configuration",
		);
	});

	it("throws on invalid DATABASE_URL", () => {
		expect(() => loadConfig({ ...validEnv, DATABASE_URL: "not-a-url" })).toThrow(
			"Invalid environment configuration",
		);
	});

	it("accepts optional REDIS_URL", () => {
		const config = loadConfig({ ...validEnv, REDIS_URL: "redis://localhost:6379" });
		expect(config.REDIS_URL).toBe("redis://localhost:6379");
	});

	it("caches config on subsequent calls", () => {
		const config1 = loadConfig(validEnv);
		const config2 = loadConfig({ ...validEnv, LOG_LEVEL: "debug" });
		expect(config1).toBe(config2);
	});
});
