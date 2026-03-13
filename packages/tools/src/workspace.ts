import { existsSync } from "node:fs";
import { lstat, mkdir, readlink, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const WORKSPACE_ROOT = "/data/workspaces";
const SUBDIRS = ["skills", "crons", "logs", "temp", "repos"] as const;

export function getWorkspaceDir(workspaceId: string): string {
	return join(WORKSPACE_ROOT, workspaceId);
}

export async function ensureWorkspace(workspaceId: string): Promise<string> {
	const dir = getWorkspaceDir(workspaceId);
	for (const sub of SUBDIRS) {
		await mkdir(join(dir, sub), { recursive: true });
	}
	return dir;
}

export function resolveSafePath(workspaceDir: string, userPath: string): string {
	const absWorkspace = resolve(workspaceDir);
	const absTarget = resolve(absWorkspace, userPath);
	if (!absTarget.startsWith(`${absWorkspace}/`) && absTarget !== absWorkspace) {
		throw new Error(`Path escapes workspace: ${userPath}`);
	}
	return absTarget;
}

export async function resolveSafePathStrict(
	workspaceDir: string,
	userPath: string,
): Promise<string> {
	const absWorkspace = resolve(workspaceDir);
	const absTarget = resolve(absWorkspace, userPath);

	if (!absTarget.startsWith(`${absWorkspace}/`) && absTarget !== absWorkspace) {
		throw new Error(`Path escapes workspace: ${userPath}`);
	}

	// Check every path component from workspace root to target for symlinks that escape.
	const relative = absTarget.slice(absWorkspace.length);
	const parts = relative.split("/").filter(Boolean);
	let current = absWorkspace;
	for (const part of parts) {
		current = join(current, part);
		if (existsSync(current)) {
			const stats = await lstat(current);
			if (stats.isSymbolicLink()) {
				const linkTarget = await readlink(current);
				const resolvedLink = resolve(current, "..", linkTarget);
				const realTarget = await realpath(resolvedLink);
				if (!realTarget.startsWith(`${absWorkspace}/`) && realTarget !== absWorkspace) {
					throw new Error(`Symlink escapes workspace: ${current} -> ${linkTarget}`);
				}
			}
		}
	}

	return absTarget;
}

export async function workspaceExists(workspaceId: string): Promise<boolean> {
	try {
		await stat(getWorkspaceDir(workspaceId));
		return true;
	} catch {
		return false;
	}
}
