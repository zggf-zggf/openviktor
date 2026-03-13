/**
 * Modal tool runner — invoked by the Python Modal app via subprocess.
 * Receives a JSON payload as argv[2], executes the tool, and prints the result as JSON.
 */
import { createNativeRegistry } from "../../../packages/tools/src/index.js";
import { ensureWorkspace } from "../../../packages/tools/src/index.js";

interface RunnerInput {
	tool_name: string;
	arguments: Record<string, unknown>;
	workspace_id: string;
	timeout_ms: number;
}

async function main(): Promise<void> {
	const raw = process.argv[2];
	if (!raw) {
		console.log(JSON.stringify({ error: "No input provided" }));
		process.exit(1);
	}

	let input: RunnerInput;
	try {
		input = JSON.parse(raw) as RunnerInput;
	} catch {
		console.log(JSON.stringify({ error: "Invalid JSON input" }));
		process.exit(1);
	}

	const registry = createNativeRegistry();

	if (!registry.has(input.tool_name)) {
		console.log(JSON.stringify({ error: `Unknown tool: ${input.tool_name}` }));
		process.exit(0);
	}

	const workspaceDir = await ensureWorkspace(input.workspace_id);
	const result = await registry.execute(input.tool_name, input.arguments, {
		workspaceId: input.workspace_id,
		workspaceDir,
		timeoutMs: input.timeout_ms,
	});

	if (result.error) {
		console.log(JSON.stringify({ error: result.error }));
	} else {
		console.log(JSON.stringify({ result: result.output }));
	}
}

main().catch((err) => {
	console.log(JSON.stringify({ error: String(err) }));
	process.exit(1);
});
