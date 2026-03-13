/**
 * Mock Modal endpoint for local testing of TOOL_BACKEND=modal.
 * Simulates the Modal web endpoint by running tools via the registry.
 *
 * Usage: bun run infra/modal/mock-server.ts
 * Then set: TOOL_BACKEND=modal MODAL_ENDPOINT_URL=http://localhost:3002
 */
import { createNativeRegistry, ensureWorkspace } from "@openviktor/tools";

const registry = createNativeRegistry();
const port = Number(process.env.MOCK_MODAL_PORT ?? 3002);

const server = Bun.serve({
	port,
	async fetch(req) {
		if (req.method !== "POST") {
			return Response.json({ error: "Not found" }, { status: 404 });
		}

		let body: {
			tool_name?: string;
			arguments?: Record<string, unknown>;
			workspace_id?: string;
			timeout_ms?: number;
			auth_token?: string;
		};

		try {
			body = (await req.json()) as typeof body;
		} catch {
			return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
		}

		if (!body.tool_name) {
			return Response.json({ error: "Missing tool_name" }, { status: 400 });
		}

		if (!registry.has(body.tool_name)) {
			return Response.json({ error: `Unknown tool: ${body.tool_name}` });
		}

		try {
			const workspaceId = body.workspace_id ?? "default";
			const workspaceDir = await ensureWorkspace(workspaceId);
			const result = await registry.execute(body.tool_name, body.arguments ?? {}, {
				workspaceId,
				workspaceDir,
				timeoutMs: body.timeout_ms ?? 600_000,
			});

			if (result.error) {
				return Response.json({ error: result.error });
			}
			return Response.json({ result: result.output });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return Response.json({ error: `Execution failed: ${message}` }, { status: 500 });
		}
	},
});

console.log(`Mock Modal endpoint running on http://localhost:${server.port}`);
