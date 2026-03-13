import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { ToolResult } from "@openviktor/shared";
import { afterEach, describe, expect, it } from "vitest";
import { LocalToolBackend, ModalToolBackend } from "../backend.js";
import type { ToolExecutionContext } from "../registry.js";

function makeCtx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
	return {
		workspaceId: "ws_test",
		workspaceDir: "/data/workspaces/ws_test",
		timeoutMs: 5_000,
		...overrides,
	};
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (chunk: Buffer) => {
			data += chunk.toString();
		});
		req.on("end", () => resolve(data));
	});
}

function startServer(
	handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; url: string }> {
	return new Promise((resolve) => {
		const server = createServer(handler);
		server.listen(0, () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			resolve({ server, url: `http://localhost:${port}` });
		});
	});
}

function stopServer(server: Server): Promise<void> {
	return new Promise((resolve) => {
		server.close(() => resolve());
	});
}

describe("LocalToolBackend", () => {
	it("delegates to the registry execute method", async () => {
		const expected: ToolResult = { output: { echoed: "hello" }, durationMs: 10 };
		const mockRegistry = {
			execute: async (
				_name: string,
				_args: Record<string, unknown>,
				_ctx: ToolExecutionContext,
			): Promise<ToolResult> => expected,
		};

		const backend = new LocalToolBackend(mockRegistry);
		const result = await backend.execute("echo", { message: "hello" }, makeCtx());
		expect(result).toBe(expected);
	});

	it("passes correct arguments through to registry", async () => {
		let capturedName = "";
		let capturedArgs: Record<string, unknown> = {};
		let capturedCtx: ToolExecutionContext | null = null;

		const mockRegistry = {
			execute: async (
				name: string,
				args: Record<string, unknown>,
				ctx: ToolExecutionContext,
			): Promise<ToolResult> => {
				capturedName = name;
				capturedArgs = args;
				capturedCtx = ctx;
				return { output: null, durationMs: 0 };
			},
		};

		const backend = new LocalToolBackend(mockRegistry);
		const ctx = makeCtx({ workspaceId: "ws_custom" });
		await backend.execute("bash", { command: "ls" }, ctx);

		expect(capturedName).toBe("bash");
		expect(capturedArgs).toEqual({ command: "ls" });
		expect(capturedCtx).toBe(ctx);
	});
});

describe("ModalToolBackend", () => {
	let activeServer: Server | null = null;

	afterEach(async () => {
		if (activeServer) {
			await stopServer(activeServer);
			activeServer = null;
		}
	});

	async function startMockModal(
		handler: (body: Record<string, unknown>) => Record<string, unknown>,
	): Promise<string> {
		const { server, url } = await startServer(async (req, res) => {
			if (req.method !== "POST") {
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Not found" }));
				return;
			}
			const raw = await readBody(req);
			const body = JSON.parse(raw) as Record<string, unknown>;
			const result = handler(body);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
		});
		activeServer = server;
		return url;
	}

	it("sends correct payload to Modal endpoint", async () => {
		let receivedBody: Record<string, unknown> = {};

		const url = await startMockModal((body) => {
			receivedBody = body;
			return { result: "ok" };
		});

		const backend = new ModalToolBackend({ endpointUrl: url });
		await backend.execute("bash", { command: "ls" }, makeCtx());

		expect(receivedBody).toEqual({
			tool_name: "bash",
			arguments: { command: "ls" },
			workspace_id: "ws_test",
			timeout_ms: 5_000,
			auth_token: undefined,
		});
	});

	it("returns successful result from Modal", async () => {
		const url = await startMockModal(() => ({ result: { files: ["a.txt", "b.txt"] } }));

		const backend = new ModalToolBackend({ endpointUrl: url });
		const result = await backend.execute("glob", { pattern: "*.txt" }, makeCtx());

		expect(result.output).toEqual({ files: ["a.txt", "b.txt"] });
		expect(result.error).toBeUndefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("returns error from Modal", async () => {
		const url = await startMockModal(() => ({ error: "Tool not found" }));

		const backend = new ModalToolBackend({ endpointUrl: url });
		const result = await backend.execute("unknown", {}, makeCtx());

		expect(result.error).toBe("Tool not found");
		expect(result.output).toBeNull();
	});

	it("handles HTTP errors from Modal", async () => {
		const { server, url } = await startServer((_req, res) => {
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		});
		activeServer = server;

		const backend = new ModalToolBackend({ endpointUrl: url });
		const result = await backend.execute("bash", {}, makeCtx());

		expect(result.error).toContain("Modal error: 500");
		expect(result.output).toBeNull();
	});

	it("handles connection failures", async () => {
		const backend = new ModalToolBackend({
			endpointUrl: "http://localhost:19999",
			timeoutMs: 1_000,
		});
		const result = await backend.execute("bash", {}, makeCtx());

		expect(result.error).toContain("Modal request failed:");
		expect(result.output).toBeNull();
	});

	it("sends auth token in request body when configured", async () => {
		let receivedToken: unknown;

		const url = await startMockModal((body) => {
			receivedToken = body.auth_token;
			return { result: "ok" };
		});

		const backend = new ModalToolBackend({
			endpointUrl: url,
			authToken: "test-secret-token",
		});
		await backend.execute("bash", {}, makeCtx());

		expect(receivedToken).toBe("test-secret-token");
	});

	it("sends undefined auth_token when no token configured", async () => {
		let receivedToken: unknown = "initial";

		const url = await startMockModal((body) => {
			receivedToken = body.auth_token;
			return { result: "ok" };
		});

		const backend = new ModalToolBackend({ endpointUrl: url });
		await backend.execute("bash", {}, makeCtx());

		expect(receivedToken).toBeUndefined();
	});

	it("respects timeout", async () => {
		const { server, url } = await startServer(async (_req, _res) => {
			// Never respond — let the client timeout
		});
		activeServer = server;

		const backend = new ModalToolBackend({ endpointUrl: url, timeoutMs: 50 });
		const result = await backend.execute("bash", {}, makeCtx());

		expect(result.error).toContain("timed out");
		expect(result.output).toBeNull();
	});

	it("strips trailing slashes from endpoint URL", async () => {
		let receivedPath = "";

		const { server, url } = await startServer(async (req, res) => {
			receivedPath = new URL(req.url ?? "/", url).pathname;
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ result: "ok" }));
		});
		activeServer = server;

		const backend = new ModalToolBackend({ endpointUrl: `${url}///` });
		await backend.execute("bash", {}, makeCtx());

		expect(receivedPath).toBe("/");
	});
});
