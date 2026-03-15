import { beforeEach, describe, expect, it } from "vitest";
import {
	getDashboardAuthMode,
	isManaged,
	isSelfHosted,
	loadConfig,
	resetConfig,
} from "../config.js";

const baseEnv = {
	SLACK_SIGNING_SECRET: "test-secret",
	ANTHROPIC_API_KEY: "sk-ant-test-key",
	DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
	NODE_ENV: "test",
};

const selfHostedEnv = {
	...baseEnv,
	DEPLOYMENT_MODE: "selfhosted",
	SLACK_BOT_TOKEN: "xoxb-test-token",
	SLACK_APP_TOKEN: "xapp-test-token",
	DASHBOARD_PASSWORD: "test-password",
};

const managedEnv = {
	...baseEnv,
	DEPLOYMENT_MODE: "managed",
	SLACK_CLIENT_ID: "client-id",
	SLACK_CLIENT_SECRET: "client-secret",
	SLACK_STATE_SECRET: "state-secret",
	BASE_URL: "https://app.example.com",
	ENCRYPTION_KEY: "a".repeat(64),
};

describe("deployment mode config", () => {
	beforeEach(() => {
		resetConfig();
	});

	describe("selfhosted mode", () => {
		it("accepts valid selfhosted config", () => {
			const config = loadConfig(selfHostedEnv);
			expect(config.DEPLOYMENT_MODE).toBe("selfhosted");
			expect(config.SLACK_BOT_TOKEN).toBe("xoxb-test-token");
		});

		it("defaults to selfhosted when DEPLOYMENT_MODE not set", () => {
			const config = loadConfig({
				...baseEnv,
				SLACK_BOT_TOKEN: "xoxb-test",
				SLACK_APP_TOKEN: "xapp-test",
				DASHBOARD_PASSWORD: "pass",
			});
			expect(config.DEPLOYMENT_MODE).toBe("selfhosted");
		});

		it("requires SLACK_BOT_TOKEN in selfhosted mode", () => {
			const env = { ...selfHostedEnv };
			delete (env as Record<string, unknown>).SLACK_BOT_TOKEN;
			expect(() => loadConfig(env)).toThrow("SLACK_BOT_TOKEN");
		});

		it("requires SLACK_APP_TOKEN in selfhosted mode", () => {
			const env = { ...selfHostedEnv };
			delete (env as Record<string, unknown>).SLACK_APP_TOKEN;
			expect(() => loadConfig(env)).toThrow("SLACK_APP_TOKEN");
		});

		it("requires DASHBOARD_PASSWORD when auth mode is basic", () => {
			const env = { ...selfHostedEnv };
			delete (env as Record<string, unknown>).DASHBOARD_PASSWORD;
			expect(() => loadConfig(env)).toThrow("DASHBOARD_PASSWORD");
		});
	});

	describe("managed mode", () => {
		it("accepts valid managed config", () => {
			const config = loadConfig(managedEnv);
			expect(config.DEPLOYMENT_MODE).toBe("managed");
			expect(config.SLACK_CLIENT_ID).toBe("client-id");
		});

		it("does not require SLACK_BOT_TOKEN in managed mode", () => {
			const config = loadConfig(managedEnv);
			expect(config.SLACK_BOT_TOKEN).toBeUndefined();
		});

		it("requires SLACK_CLIENT_ID in managed mode", () => {
			const env = { ...managedEnv };
			delete (env as Record<string, unknown>).SLACK_CLIENT_ID;
			expect(() => loadConfig(env)).toThrow("SLACK_CLIENT_ID");
		});

		it("requires SLACK_CLIENT_SECRET in managed mode", () => {
			const env = { ...managedEnv };
			delete (env as Record<string, unknown>).SLACK_CLIENT_SECRET;
			expect(() => loadConfig(env)).toThrow("SLACK_CLIENT_SECRET");
		});

		it("requires SLACK_STATE_SECRET in managed mode", () => {
			const env = { ...managedEnv };
			delete (env as Record<string, unknown>).SLACK_STATE_SECRET;
			expect(() => loadConfig(env)).toThrow("SLACK_STATE_SECRET");
		});

		it("requires BASE_URL in managed mode", () => {
			const env = { ...managedEnv };
			delete (env as Record<string, unknown>).BASE_URL;
			expect(() => loadConfig(env)).toThrow("BASE_URL");
		});

		it("requires ENCRYPTION_KEY in managed mode", () => {
			const env = { ...managedEnv };
			delete (env as Record<string, unknown>).ENCRYPTION_KEY;
			expect(() => loadConfig(env)).toThrow("ENCRYPTION_KEY");
		});
	});

	describe("helper functions", () => {
		it("isManaged returns true for managed mode", () => {
			const config = loadConfig(managedEnv);
			expect(isManaged(config)).toBe(true);
			expect(isSelfHosted(config)).toBe(false);
		});

		it("isSelfHosted returns true for selfhosted mode", () => {
			const config = loadConfig(selfHostedEnv);
			expect(isSelfHosted(config)).toBe(true);
			expect(isManaged(config)).toBe(false);
		});

		it("getDashboardAuthMode defaults to basic for selfhosted", () => {
			const config = loadConfig(selfHostedEnv);
			expect(getDashboardAuthMode(config)).toBe("basic");
		});

		it("getDashboardAuthMode defaults to slack-oauth for managed", () => {
			const config = loadConfig(managedEnv);
			expect(getDashboardAuthMode(config)).toBe("slack-oauth");
		});

		it("getDashboardAuthMode respects explicit override", () => {
			const config = loadConfig({
				...managedEnv,
				DASHBOARD_AUTH_MODE: "basic",
				DASHBOARD_PASSWORD: "test",
			});
			expect(getDashboardAuthMode(config)).toBe("basic");
		});
	});

	describe("ENABLE_DASHBOARD", () => {
		it("defaults to true", () => {
			const config = loadConfig(selfHostedEnv);
			expect(config.ENABLE_DASHBOARD).toBe(true);
		});

		it("can be disabled", () => {
			const config = loadConfig({ ...selfHostedEnv, ENABLE_DASHBOARD: "false" });
			expect(config.ENABLE_DASHBOARD).toBe(false);
		});
	});
});
