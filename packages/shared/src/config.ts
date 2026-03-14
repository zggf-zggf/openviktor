import { z } from "zod";

const envSchema = z
	.object({
		// Slack
		SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
		SLACK_APP_TOKEN: z.string().startsWith("xapp-"),
		SLACK_SIGNING_SECRET: z.string().min(1),

		// LLM
		ANTHROPIC_API_KEY: z.string().min(1),
		OPENAI_API_KEY: z.string().optional(),
		GOOGLE_AI_API_KEY: z.string().optional(),
		DEFAULT_MODEL: z.string().default("claude-sonnet-4-20250514"),
		MAX_TOKENS: z.coerce.number().default(4096),

		// Database
		DATABASE_URL: z.string().url(),

		// Redis (optional for single-instance)
		REDIS_URL: z.string().url().optional(),

		// Application
		LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
		NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

		// Limits
		MAX_CONCURRENT_RUNS: z.coerce.number().default(16),
		TOOL_TIMEOUT_MS: z.coerce.number().default(600_000),
		AGENT_TIMEOUT_MS: z.coerce.number().default(300_000),
		BASH_DEFAULT_TIMEOUT_MS: z.coerce.number().default(120_000),
		STALE_THREAD_TIMEOUT_MS: z.coerce.number().int().min(60_000).default(86_400_000),
		STALE_CHECK_INTERVAL_MS: z.coerce.number().int().min(10_000).default(900_000),
		THREAD_LOCK_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(300_000),
		GITHUB_TOKEN: z.string().optional(),
		BROWSERBASE_API_KEY: z.string().optional(),
		CONTEXT7_BASE_URL: z.string().url().optional(),
		SEARCH_API_KEY: z.string().optional(),
		IMAGEN_API_KEY: z.string().optional(),

		// Tool gateway
		TOOL_GATEWAY_PORT: z.coerce.number().default(3001),

		// Tool backend
		TOOL_BACKEND: z.enum(["local", "modal"]).default("local"),
		MODAL_ENDPOINT_URL: z.string().url().optional(),
		MODAL_AUTH_TOKEN: z.string().min(1).optional(),

		// Cron scheduler
		CRON_CHECK_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
		HEARTBEAT_ENABLED: z
			.enum(["true", "false"])
			.default("true")
			.transform((v) => v === "true"),

		// Pipedream Connect
		PIPEDREAM_CLIENT_ID: z.string().optional(),
		PIPEDREAM_CLIENT_SECRET: z.string().optional(),
		PIPEDREAM_PROJECT_ID: z.string().optional(),
		PIPEDREAM_ENVIRONMENT: z.enum(["development", "production"]).default("development"),

		// Permissions
		DANGEROUSLY_SKIP_PERMISSIONS: z
			.enum(["true", "false"])
			.default("false")
			.transform((v) => v === "true"),
	})
	.superRefine((data, ctx) => {
		if (data.TOOL_BACKEND === "modal" && !data.MODAL_ENDPOINT_URL) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "MODAL_ENDPOINT_URL is required when TOOL_BACKEND=modal",
				path: ["MODAL_ENDPOINT_URL"],
			});
		}
		const pdFields = [
			data.PIPEDREAM_CLIENT_ID,
			data.PIPEDREAM_CLIENT_SECRET,
			data.PIPEDREAM_PROJECT_ID,
		];
		const pdSet = pdFields.filter(Boolean).length;
		if (pdSet > 0 && pdSet < 3) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"All three PIPEDREAM_CLIENT_ID, PIPEDREAM_CLIENT_SECRET, and PIPEDREAM_PROJECT_ID must be set together",
				path: ["PIPEDREAM_CLIENT_ID"],
			});
		}
	});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;

export function loadConfig(env: Record<string, string | undefined> = process.env): EnvConfig {
	if (cachedConfig) return cachedConfig;
	const result = envSchema.safeParse(env);
	if (!result.success) {
		const formatted = result.error.issues
			.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
			.join("\n");
		throw new Error(`Invalid environment configuration:\n${formatted}`);
	}
	cachedConfig = result.data;
	return cachedConfig;
}

export function resetConfig(): void {
	cachedConfig = null;
}
