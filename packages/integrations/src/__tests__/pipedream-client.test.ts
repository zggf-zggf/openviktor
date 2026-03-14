import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipedreamClient } from "../pipedream/client.js";
import type { PipedreamConfig } from "../pipedream/types.js";

const TEST_CONFIG: PipedreamConfig = {
	clientId: "test-client-id",
	clientSecret: "test-client-secret",
	projectId: "test-project-id",
	environment: "development",
};

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
	return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const result = handler(url, init);
		if (result instanceof Response) return result;
		return Response.json(result);
	});
}

describe("PipedreamClient", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function setupFetch() {
		const fetchMock = mockFetch((url, init) => {
			if (url.includes("/oauth/token")) {
				return { access_token: "test-access-token" };
			}

			if (url.includes("/apps") && !url.includes("/actions")) {
				return {
					data: [
						{
							name_slug: "google_sheets",
							name: "Google Sheets",
							description: "Read and write data",
							auth_type: "oauth",
						},
					],
				};
			}

			if (
				url.includes("/actions") &&
				url.includes("app=google_sheets") &&
				!url.includes("/run") &&
				!url.includes("/configure")
			) {
				return {
					data: [
						{
							id: "action-123",
							key: "google_sheets-add-single-row",
							name: "Add Single Row",
							description: "Add a row",
							version: "0.2.0",
							configurable_props: [
								{ name: "google_sheets", type: "app", app: "google_sheets" },
								{ name: "sheetId", type: "string", label: "Spreadsheet" },
							],
						},
					],
				};
			}

			if (url.includes("/actions/run")) {
				return { ret: { success: true, rows_added: 1 } };
			}

			if (url.includes("/actions/configure")) {
				return { options: [{ label: "Sheet 1", value: "sheet-1" }] };
			}

			if (url.includes("/tokens") && init?.method === "POST") {
				return {
					token: "connect-token-123",
					expires_at: "2026-03-15T00:00:00Z",
					connect_link_url: "https://pipedream.com/connect/test",
				};
			}

			if (url.includes("/accounts") && (!init?.method || init.method === "GET")) {
				return {
					data: [
						{
							id: "apn-123",
							app: { name_slug: "google_sheets", name: "Google Sheets" },
							healthy: true,
						},
					],
				};
			}

			if (url.includes("/accounts/") && init?.method === "DELETE") {
				return new Response(null, { status: 204 });
			}

			if (url.includes("/proxy")) {
				return { status: 200, data: { result: "proxied" } };
			}

			return new Response("Not found", { status: 404 });
		});

		globalThis.fetch = fetchMock as unknown as typeof fetch;
		return fetchMock;
	}

	it("lists apps with search query", async () => {
		setupFetch();
		const client = new PipedreamClient(TEST_CONFIG);
		const apps = await client.listApps({ q: "google", hasActions: true, limit: 10 });

		expect(apps).toHaveLength(1);
		expect(apps[0].name_slug).toBe("google_sheets");
		expect(apps[0].name).toBe("Google Sheets");
	});

	it("lists actions for an app", async () => {
		setupFetch();
		const client = new PipedreamClient(TEST_CONFIG);
		const actions = await client.listActions({ app: "google_sheets" });

		expect(actions).toHaveLength(1);
		expect(actions[0].key).toBe("google_sheets-add-single-row");
		expect(actions[0].configurable_props).toHaveLength(2);
	});

	it("runs an action", async () => {
		setupFetch();
		const client = new PipedreamClient(TEST_CONFIG);
		const result = await client.runAction({
			actionId: "action-123",
			externalUserId: "workspace_test",
			configuredProps: { sheetId: "sheet-1" },
		});

		expect(result.ret).toEqual({ success: true, rows_added: 1 });
	});

	it("configures dynamic props", async () => {
		setupFetch();
		const client = new PipedreamClient(TEST_CONFIG);
		const result = await client.configure({
			actionKey: "google_sheets-add-single-row",
			propName: "sheetId",
			externalUserId: "workspace_test",
		});

		expect(result).toHaveProperty("options");
	});

	it("creates a connect token", async () => {
		setupFetch();
		const client = new PipedreamClient(TEST_CONFIG);
		const token = await client.createConnectToken("workspace_test");

		expect(token.token).toBe("connect-token-123");
		expect(token.connect_link_url).toContain("pipedream.com/connect");
	});

	it("lists accounts", async () => {
		setupFetch();
		const client = new PipedreamClient(TEST_CONFIG);
		const accounts = await client.listAccounts("workspace_test");

		expect(accounts).toHaveLength(1);
		expect(accounts[0].app?.name_slug).toBe("google_sheets");
	});

	it("makes proxy requests", async () => {
		setupFetch();
		const client = new PipedreamClient(TEST_CONFIG);
		const result = (await client.proxyRequest({
			app: "google_sheets",
			method: "GET",
			url: "https://sheets.googleapis.com/v4/spreadsheets",
			externalUserId: "workspace_test",
			authProvisionId: "apn-123",
		})) as Record<string, unknown>;

		expect(result).toHaveProperty("data");
	});

	it("caches OAuth tokens", async () => {
		const fetchMock = setupFetch();
		const client = new PipedreamClient(TEST_CONFIG);

		await client.listApps({ q: "test" });
		await client.listApps({ q: "test2" });

		// OAuth token should only be fetched once
		const oauthCalls = fetchMock.mock.calls.filter((call) =>
			String(call[0]).includes("/oauth/token"),
		);
		expect(oauthCalls).toHaveLength(1);
	});

	it("throws on API errors", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify({ access_token: "test" }), { status: 200 });
		}) as unknown as typeof fetch;

		const client = new PipedreamClient(TEST_CONFIG);

		// Override fetch after token is cached
		globalThis.fetch = vi.fn(async () => {
			return new Response("Unauthorized", { status: 401 });
		}) as unknown as typeof fetch;

		// Force a new token fetch by creating a new client
		const client2 = new PipedreamClient(TEST_CONFIG);
		await expect(client2.listApps({ q: "test" })).rejects.toThrow("Pipedream");
	});
});
