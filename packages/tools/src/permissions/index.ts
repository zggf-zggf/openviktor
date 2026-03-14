export {
	submitPermissionRequestDefinition,
	createSubmitPermissionRequestExecutor,
} from "./checker.js";
export {
	type PermissionRequiredOutput,
	isPermissionRequired,
	PERMISSION_POLL_INTERVAL_MS,
	PERMISSION_TIMEOUT_MS,
} from "./gate.js";
