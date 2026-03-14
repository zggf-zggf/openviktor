export interface PermissionRequiredOutput {
	_permissionRequired: true;
	permissionRequestId: string;
	toolName: string;
	toolInput: Record<string, unknown>;
}

export function isPermissionRequired(output: unknown): output is PermissionRequiredOutput {
	if (typeof output !== "object" || output === null) return false;
	const obj = output as Record<string, unknown>;
	return (
		obj._permissionRequired === true &&
		typeof obj.permissionRequestId === "string" &&
		typeof obj.toolName === "string"
	);
}

export const PERMISSION_POLL_INTERVAL_MS = 2000;
export const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;
