import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePath, resolveSafePathStrict } from "../workspace.js";

type TreeEntry = {
	name: string;
	path: string;
	isDirectory: boolean;
};

const SKIP_DIRS = new Set(["node_modules", ".git", "slack", "slack_visible"]);

function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes}B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)}KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isCurrentPath(entryPath: string, currentPath?: string): boolean {
	if (!currentPath) {
		return false;
	}
	const resolvedEntry = resolve(entryPath);
	const resolvedCurrent = resolve(currentPath);
	return (
		resolvedEntry === resolvedCurrent ||
		resolvedCurrent.startsWith(`${resolvedEntry}/`) ||
		resolvedEntry.startsWith(`${resolvedCurrent}/`)
	);
}

async function gatherVisibleEntries(dir: string): Promise<TreeEntry[]> {
	const rawEntries = await readdir(dir, { withFileTypes: true });
	const visible: TreeEntry[] = [];

	for (const entry of rawEntries) {
		if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
			continue;
		}
		if (!entry.isDirectory() && entry.name.endsWith(".lock")) {
			continue;
		}
		visible.push({
			name: entry.name,
			path: join(dir, entry.name),
			isDirectory: entry.isDirectory(),
		});
	}

	visible.sort((a, b) => a.name.localeCompare(b.name));
	return visible;
}

async function renderFileEntry(
	entry: TreeEntry,
	connector: string,
	depth: number,
): Promise<string> {
	if (depth <= 1) {
		const fileStats = await stat(entry.path);
		return `${connector}${entry.name} (${formatSize(fileStats.size)})`;
	}
	return `${connector}${entry.name}`;
}

async function renderDirectoryEntry(
	entry: TreeEntry,
	connector: string,
	continuation: string,
	relativeDir: string,
	workspaceDir: string,
	maxItems: number,
	depth: number,
	currentPath?: string,
): Promise<string[]> {
	const currentMarker = isCurrentPath(entry.path, currentPath) ? " ← (current)" : "";

	if (relativeDir === "skills") {
		return [`${connector}${entry.name}/${currentMarker}`];
	}
	if (relativeDir === "repos") {
		return [`${connector}${entry.name}/ (repo)${currentMarker}`];
	}

	const childTree = await buildTree(entry.path, workspaceDir, maxItems, depth + 1, currentPath);
	if (!childTree.trim()) {
		return [`${connector}${entry.name}/${currentMarker}`];
	}

	const indentedChild = childTree
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => `${continuation}${line}`)
		.join("\n");

	return [`${connector}${entry.name}/${currentMarker}`, indentedChild];
}

export async function buildTree(
	dir: string,
	workspaceDir: string,
	maxItems: number,
	depth: number,
	currentPath?: string,
): Promise<string> {
	const visibleEntries = await gatherVisibleEntries(dir);
	const relativeDir = relative(workspaceDir, dir).replaceAll("\\", "/");

	let effectiveEntries = visibleEntries;
	let hiddenCount = 0;
	if (depth >= 2 && visibleEntries.length > maxItems) {
		effectiveEntries = visibleEntries.slice(0, maxItems);
		hiddenCount = visibleEntries.length - maxItems;
	}

	const lines: string[] = [];
	for (const [index, entry] of effectiveEntries.entries()) {
		const isLast = index === effectiveEntries.length - 1 && hiddenCount === 0;
		const connector = isLast ? "└── " : "├── ";
		const continuation = isLast ? "    " : "│   ";
		const currentMarker = isCurrentPath(entry.path, currentPath) ? " ← (current)" : "";

		if (!entry.isDirectory) {
			const line = await renderFileEntry(entry, connector, depth);
			lines.push(`${line}${currentMarker}`);
			continue;
		}

		const directoryLines = await renderDirectoryEntry(
			entry,
			connector,
			continuation,
			relativeDir,
			workspaceDir,
			maxItems,
			depth,
			currentPath,
		);
		lines.push(...directoryLines);
	}

	if (hiddenCount > 0) {
		lines.push(`└── ... ${hiddenCount} more`);
	}

	return lines.join("\n");
}

export const workspaceTreeDefinition: LLMToolDefinition = {
	name: "workspace_tree",
	description: "Show a focused tree view of the workspace.",
	input_schema: {
		type: "object",
		properties: {
			max_items_per_folder: {
				type: "number",
				description: "Maximum entries shown per folder at depth >= 2",
			},
			current_path: {
				type: "string",
				description: "Optional path relative to workspace to mark as current",
			},
		},
		required: [],
	},
};

export const workspaceTreeExecutor: ToolExecutor = async (args, ctx) => {
	const maxItems = typeof args.max_items_per_folder === "number" ? args.max_items_per_folder : 3;
	try {
		const workspaceDir = resolveSafePath(ctx.workspaceDir, ".");
		await resolveSafePathStrict(ctx.workspaceDir, ".");

		let currentPath: string | undefined;
		if (typeof args.current_path === "string") {
			currentPath = resolveSafePath(workspaceDir, args.current_path);
			await resolveSafePathStrict(workspaceDir, args.current_path);
		}

		const tree = await buildTree(workspaceDir, workspaceDir, maxItems, 0, currentPath);
		return {
			output: {
				tree: `./\n${tree}`,
			},
			durationMs: 0,
		};
	} catch (err) {
		return { output: null, durationMs: 0, error: err instanceof Error ? err.message : String(err) };
	}
};
