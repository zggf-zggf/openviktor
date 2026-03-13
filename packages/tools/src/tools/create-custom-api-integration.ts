import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePath } from "../workspace.js";

const AUTH_TYPES = new Set(["bearer", "api_key", "basic", "none"]);

export const createCustomApiIntegrationDefinition: LLMToolDefinition = {
	name: "create_custom_api_integration",
	description: "Create a custom API integration configuration file in the workspace.",
	input_schema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "Integration name (alphanumeric and hyphens only)",
			},
			base_url: {
				type: "string",
				description: "Base URL for the API",
			},
			description: {
				type: "string",
				description: "Human-readable description of the integration",
			},
			auth_type: {
				type: "string",
				enum: ["bearer", "api_key", "basic", "none"],
				description: "Authentication type",
			},
			auth_header: {
				type: "string",
				description: "Header name for API key authentication",
			},
		},
		required: ["name", "base_url", "description"],
	},
};

export const createCustomApiIntegrationExecutor: ToolExecutor = async (args, ctx) => {
	try {
		if (typeof args.name !== "string" || args.name.length === 0) {
			return { output: null, durationMs: 0, error: "name is required" };
		}
		if (!/^[a-z0-9-]+$/.test(args.name)) {
			return {
				output: null,
				durationMs: 0,
				error: "Invalid name: must contain only lowercase letters, numbers, and hyphens",
			};
		}
		if (typeof args.base_url !== "string" || args.base_url.length === 0) {
			return { output: null, durationMs: 0, error: "base_url is required" };
		}
		if (typeof args.description !== "string" || args.description.length === 0) {
			return { output: null, durationMs: 0, error: "description is required" };
		}

		try {
			new URL(args.base_url);
		} catch {
			return { output: null, durationMs: 0, error: "Invalid base_url: must be a valid URL" };
		}

		const authType = typeof args.auth_type === "string" ? args.auth_type : "bearer";
		if (!AUTH_TYPES.has(authType)) {
			return {
				output: null,
				durationMs: 0,
				error: "Invalid auth_type: must be one of bearer, api_key, basic, none",
			};
		}

		const authHeader = typeof args.auth_header === "string" ? args.auth_header : "Authorization";
		const integrationsDir = resolveSafePath(ctx.workspaceDir, ".integrations");
		const relativeConfigPath = join(".integrations", `${args.name}.json`);
		const configPath = resolveSafePath(ctx.workspaceDir, relativeConfigPath);

		await mkdir(integrationsDir, { recursive: true });
		await writeFile(
			configPath,
			JSON.stringify(
				{
					name: args.name,
					base_url: args.base_url,
					description: args.description,
					auth_type: authType,
					auth_header: authHeader,
					created_at: new Date().toISOString(),
				},
				null,
				2,
			),
			"utf-8",
		);

		return {
			output: {
				integration_id: args.name,
				config_path: relativeConfigPath,
			},
			durationMs: 0,
		};
	} catch (error) {
		return {
			output: null,
			durationMs: 0,
			error: error instanceof Error ? error.message : String(error),
		};
	}
};
