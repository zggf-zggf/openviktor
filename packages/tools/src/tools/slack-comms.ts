import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LLMToolDefinition } from "@openviktor/shared";
import { markdownToMrkdwn } from "@openviktor/shared";
import type { ToolExecutionContext, ToolExecutor } from "../registry.js";
import { resolveSafePath } from "../workspace.js";

type SlackToolName =
	| "coworker_slack_history"
	| "coworker_send_slack_message"
	| "coworker_slack_react"
	| "coworker_delete_slack_message"
	| "coworker_update_slack_message"
	| "coworker_upload_to_slack"
	| "coworker_download_from_slack"
	| "create_thread"
	| "send_message_to_thread"
	| "wait_for_paths";

type JsonRecord = Record<string, unknown>;

interface SlackApiSuccess {
	ok: true;
	data: JsonRecord;
}

interface SlackApiFailure {
	ok: false;
	error: string;
}

const SLACK_API_BASE_URL = "https://slack.com/api";

export const coworkerSlackHistoryDefinition: LLMToolDefinition = {
	name: "coworker_slack_history",
	description: "Fetch Slack channel message history.",
	input_schema: {
		type: "object",
		properties: {
			channel: { type: "string", description: "Slack channel ID" },
			limit: { type: "number", description: "Maximum messages to return (default: 20)" },
			oldest: { type: "string", description: "Oldest timestamp boundary" },
			latest: { type: "string", description: "Latest timestamp boundary" },
		},
		required: ["channel"],
	},
};

export const coworkerSendSlackMessageDefinition: LLMToolDefinition = {
	name: "coworker_send_slack_message",
	description:
		"Send a Slack message to a channel or thread. Supports Block Kit for rich formatting. Requires a reflection before sending — set do_send to false to suppress the message after reflection.",
	input_schema: {
		type: "object",
		properties: {
			channel_id: { type: "string", description: "Slack channel or user ID" },
			text: { type: "string", description: "Message text (also serves as fallback for blocks)" },
			blocks: {
				type: "array",
				description:
					"Block Kit blocks for rich formatting (sections, headers, dividers, images). When provided, text becomes the notification fallback.",
				items: { type: "object" },
			},
			reflection: {
				type: "string",
				description:
					"Private pre-send self-review. Evaluate: Is this helpful? Accurate? Appropriate tone? Right audience?",
			},
			do_send: {
				type: "boolean",
				description: "Set to true to send the message, false to suppress it after reflection.",
			},
			thread_ts: {
				type: "string",
				description: "Thread timestamp to reply in (omit for top-level messages)",
			},
			message_type: {
				type: "string",
				enum: ["regular", "permission_request"],
				description: "Message type. 'permission_request' renders Approve/Reject action buttons.",
			},
			replace_message_ts: {
				type: "string",
				description:
					"If provided, update this existing message instead of posting a new one (uses chat.update).",
			},
			permission_request_draft_ids: {
				type: "array",
				items: { type: "string" },
				description: "Draft IDs linked to this permission request message.",
			},
			detailed_approval_context: {
				type: "string",
				description: "Additional context shown when a permission request is approved.",
			},
		},
		required: ["channel_id", "text", "reflection", "do_send"],
	},
};

export const coworkerSlackReactDefinition: LLMToolDefinition = {
	name: "coworker_slack_react",
	description: "Add an emoji reaction to a Slack message.",
	input_schema: {
		type: "object",
		properties: {
			channel: { type: "string", description: "Slack channel ID" },
			timestamp: { type: "string", description: "Message timestamp" },
			emoji: { type: "string", description: "Emoji name without colons" },
		},
		required: ["channel", "timestamp", "emoji"],
	},
};

export const coworkerDeleteSlackMessageDefinition: LLMToolDefinition = {
	name: "coworker_delete_slack_message",
	description: "Delete a Slack message.",
	input_schema: {
		type: "object",
		properties: {
			channel: { type: "string", description: "Slack channel ID" },
			timestamp: { type: "string", description: "Message timestamp" },
		},
		required: ["channel", "timestamp"],
	},
};

export const coworkerUpdateSlackMessageDefinition: LLMToolDefinition = {
	name: "coworker_update_slack_message",
	description: "Update an existing Slack message.",
	input_schema: {
		type: "object",
		properties: {
			channel: { type: "string", description: "Slack channel ID" },
			timestamp: { type: "string", description: "Message timestamp to update" },
			text: { type: "string", description: "New message text" },
			blocks: {
				type: "array",
				description: "Optional Block Kit blocks for rich formatting",
				items: { type: "object" },
			},
		},
		required: ["channel", "timestamp", "text"],
	},
};

export const coworkerUploadToSlackDefinition: LLMToolDefinition = {
	name: "coworker_upload_to_slack",
	description: "Upload a local file to Slack using external upload APIs.",
	input_schema: {
		type: "object",
		properties: {
			channel: { type: "string", description: "Slack channel ID" },
			file_path: { type: "string", description: "Workspace-relative file path" },
			filename: { type: "string", description: "Optional upload filename" },
			title: { type: "string", description: "Optional file title" },
		},
		required: ["channel", "file_path"],
	},
};

export const coworkerDownloadFromSlackDefinition: LLMToolDefinition = {
	name: "coworker_download_from_slack",
	description: "Download a Slack file URL into the workspace.",
	input_schema: {
		type: "object",
		properties: {
			url: { type: "string", description: "Slack file URL" },
			save_path: { type: "string", description: "Workspace-relative destination path" },
		},
		required: ["url", "save_path"],
	},
};

export const createThreadDefinition: LLMToolDefinition = {
	name: "create_thread",
	description: "Create a new Slack thread by posting a root message.",
	input_schema: {
		type: "object",
		properties: {
			channel: { type: "string", description: "Slack channel ID" },
			text: { type: "string", description: "Root message text" },
		},
		required: ["channel", "text"],
	},
};

export const sendMessageToThreadDefinition: LLMToolDefinition = {
	name: "send_message_to_thread",
	description: "Send a reply into an existing Slack thread.",
	input_schema: {
		type: "object",
		properties: {
			channel: { type: "string", description: "Slack channel ID" },
			thread_ts: { type: "string", description: "Root thread timestamp" },
			text: { type: "string", description: "Reply text" },
		},
		required: ["channel", "thread_ts", "text"],
	},
};

export const waitForPathsDefinition: LLMToolDefinition = {
	name: "wait_for_paths",
	description: "Wait for one or more workspace paths to appear.",
	input_schema: {
		type: "object",
		properties: {
			paths: {
				type: "array",
				items: { type: "string" },
				description: "Workspace-relative paths to wait for",
			},
			timeout_ms: { type: "number", description: "Max wait time in milliseconds (default: 30000)" },
			poll_interval_ms: {
				type: "number",
				description: "Polling interval in milliseconds (default: 500)",
			},
		},
		required: ["paths"],
	},
};

async function slackApiCall(
	slackToken: string,
	method: string,
	params: Record<string, string>,
): Promise<SlackApiSuccess | SlackApiFailure> {
	try {
		const body = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			body.set(key, value);
		}

		const response = await fetch(`${SLACK_API_BASE_URL}/${method}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${slackToken}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
		});

		if (!response.ok) {
			return { ok: false, error: `Slack API HTTP ${response.status}: ${response.statusText}` };
		}

		const payload = (await response.json()) as unknown;
		if (!isRecord(payload)) {
			return { ok: false, error: "Invalid Slack API response shape" };
		}

		if (payload.ok !== true) {
			const slackError = typeof payload.error === "string" ? payload.error : "unknown_error";
			return { ok: false, error: `Slack API error (${method}): ${slackError}` };
		}

		return { ok: true, data: payload };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	}
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null;
}

function getRequiredString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Invalid or missing required argument: ${key}`);
	}
	return value;
}

function getOptionalString(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`Invalid argument type for ${key}; expected string`);
	}
	return value;
}

function getOptionalNumber(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "number" || Number.isNaN(value)) {
		throw new Error(`Invalid argument type for ${key}; expected number`);
	}
	return value;
}

interface UploadToSlackArgs {
	channel: string;
	filePath: string;
	filename: string;
	title: string;
}

interface UploadInitData {
	uploadUrl: string;
	fileId: string;
}

interface WaitForPathsArgs {
	inputPaths: string[];
	timeoutMs: number;
	pollIntervalMs: number;
}

interface ResolvedPathTarget {
	relative: string;
	absolute: string;
}

function parseUploadToSlackArgs(args: Record<string, unknown>): UploadToSlackArgs {
	const filePath = getRequiredString(args, "file_path");
	const filename = getOptionalString(args, "filename") ?? path.basename(filePath);
	return {
		channel: getRequiredString(args, "channel"),
		filePath,
		filename,
		title: getOptionalString(args, "title") ?? filename,
	};
}

function parseUploadInitData(data: JsonRecord): UploadInitData {
	const uploadUrl = typeof data.upload_url === "string" ? data.upload_url : undefined;
	const fileId = typeof data.file_id === "string" ? data.file_id : undefined;
	if (!uploadUrl || !fileId) {
		throw new Error("Slack response missing upload_url or file_id");
	}
	return { uploadUrl, fileId };
}

async function uploadContentToSlack(uploadUrl: string, content: Buffer): Promise<void> {
	const uploadResponse = await fetch(uploadUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/octet-stream",
		},
		body: content,
	});
	if (!uploadResponse.ok) {
		throw new Error(`Slack file upload failed with HTTP ${uploadResponse.status}`);
	}
}

function extractUploadPermalink(data: JsonRecord): string {
	if (isRecord(data.file) && typeof data.file.permalink === "string") {
		return data.file.permalink;
	}
	if (Array.isArray(data.files) && data.files.length > 0) {
		const first = data.files[0];
		if (isRecord(first) && typeof first.permalink === "string") {
			return first.permalink;
		}
	}
	return "";
}

function parseWaitForPathsArgs(args: Record<string, unknown>): WaitForPathsArgs {
	const rawPaths = args.paths;
	if (!Array.isArray(rawPaths) || rawPaths.some((entry) => typeof entry !== "string")) {
		throw new Error("Invalid or missing required argument: paths");
	}
	const timeoutMs = getOptionalNumber(args, "timeout_ms") ?? 30_000;
	const pollIntervalMs = getOptionalNumber(args, "poll_interval_ms") ?? 500;
	if (timeoutMs < 0 || pollIntervalMs <= 0) {
		throw new Error("timeout_ms must be >= 0 and poll_interval_ms must be > 0");
	}
	return {
		inputPaths: [...new Set(rawPaths as string[])],
		timeoutMs,
		pollIntervalMs,
	};
}

function resolveWaitForPathTargets(
	workspaceDir: string,
	inputPaths: string[],
): ResolvedPathTarget[] {
	return inputPaths.map((targetPath) => ({
		relative: targetPath,
		absolute: resolveSafePath(workspaceDir, targetPath),
	}));
}

async function markFoundPaths(found: Set<string>, targets: ResolvedPathTarget[]): Promise<void> {
	for (const target of targets) {
		if (found.has(target.relative)) {
			continue;
		}
		try {
			await access(target.absolute);
			found.add(target.relative);
		} catch {}
	}
}

function sleep(durationMs: number): Promise<void> {
	return new Promise<void>((resolve) => {
		setTimeout(resolve, durationMs);
	});
}

async function waitForResolvedPathTargets(
	targets: ResolvedPathTarget[],
	timeoutMs: number,
	pollIntervalMs: number,
): Promise<{ found: Set<string>; elapsedMs: number }> {
	const found = new Set<string>();
	const start = Date.now();

	while (Date.now() - start <= timeoutMs) {
		await markFoundPaths(found, targets);
		if (found.size === targets.length) {
			break;
		}
		await sleep(pollIntervalMs);
	}

	return {
		found,
		elapsedMs: Date.now() - start,
	};
}
function createCoworkerSlackHistoryExecutor(slackToken: string): ToolExecutor {
	return async (args) => {
		try {
			const channel = getRequiredString(args, "channel");
			const limit = getOptionalNumber(args, "limit") ?? 20;
			const oldest = getOptionalString(args, "oldest");
			const latest = getOptionalString(args, "latest");

			const params: Record<string, string> = {
				channel,
				limit: String(limit),
			};
			if (oldest) {
				params.oldest = oldest;
			}
			if (latest) {
				params.latest = latest;
			}

			const apiResult = await slackApiCall(slackToken, "conversations.history", params);
			if (!apiResult.ok) {
				return { output: null, durationMs: 0, error: apiResult.error };
			}

			const rawMessages = Array.isArray(apiResult.data.messages) ? apiResult.data.messages : [];
			const messages = rawMessages
				.filter(
					(message): message is Record<string, unknown> =>
						isRecord(message) && typeof (message as Record<string, unknown>).ts === "string",
				)
				.map((message) => ({
					ts: message.ts as string,
					user: typeof message.user === "string" ? message.user : undefined,
					text: typeof message.text === "string" ? message.text : undefined,
					thread_ts: typeof message.thread_ts === "string" ? message.thread_ts : undefined,
				}));

			return {
				output: {
					messages,
					has_more: apiResult.data.has_more === true,
				},
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

function resolveChannelId(args: Record<string, unknown>): string {
	const channelId = args.channel_id ?? args.channel;
	if (typeof channelId !== "string" || channelId.length === 0) {
		throw new Error("Invalid or missing required argument: channel_id");
	}
	return channelId;
}

function parseMessageResponse(
	data: JsonRecord,
	fallbackChannel: string,
): { ts: string; channel: string } | null {
	const ts = typeof data.ts === "string" ? data.ts : "";
	if (!ts) return null;
	const channel = typeof data.channel === "string" ? data.channel : fallbackChannel;
	return { ts, channel };
}

function buildPermissionRequestBlocks(
	text: string,
	requestId: string,
	detailedApprovalContext: string | undefined,
	inputBlocks: unknown[],
): unknown[] {
	const blocks =
		inputBlocks.length === 0
			? [{ type: "section", text: { type: "mrkdwn", text } }]
			: [...inputBlocks];

	if (detailedApprovalContext) {
		blocks.push({
			type: "context",
			elements: [{ type: "mrkdwn", text: detailedApprovalContext }],
		});
	}

	blocks.push({
		type: "actions",
		elements: [
			{
				type: "button",
				text: { type: "plain_text", text: "Approve" },
				style: "primary",
				action_id: "permission_approve",
				value: requestId,
			},
			{
				type: "button",
				text: { type: "plain_text", text: "Reject" },
				style: "danger",
				action_id: "permission_reject",
				value: requestId,
			},
		],
	});
	return blocks;
}

function buildSendParams(
	channelId: string,
	text: string,
	threadTs: string | undefined,
	blocks: unknown[],
): Record<string, string> {
	const params: Record<string, string> = { channel: channelId, text };
	if (threadTs) params.thread_ts = threadTs;
	if (blocks.length > 0) {
		params.blocks = JSON.stringify(blocks);
	}
	return params;
}

async function execUpdateMessage(
	slackToken: string,
	params: Record<string, string>,
	replaceMessageTs: string,
	channelId: string,
	reflection: string,
): Promise<{ output: unknown; durationMs: number; error?: string }> {
	const updateParams = { ...params, ts: replaceMessageTs };
	const apiResult = await slackApiCall(slackToken, "chat.update", updateParams);
	if (!apiResult.ok) {
		return { output: null, durationMs: 0, error: apiResult.error };
	}
	return {
		output: { status: "updated", ts: replaceMessageTs, channel: channelId, reflection },
		durationMs: 0,
	};
}

async function execPostMessage(
	slackToken: string,
	params: Record<string, string>,
	channelId: string,
	reflection: string,
	messageType: string,
): Promise<{ output: unknown; durationMs: number; error?: string }> {
	const apiResult = await slackApiCall(slackToken, "chat.postMessage", params);
	if (!apiResult.ok) {
		return { output: null, durationMs: 0, error: apiResult.error };
	}
	const parsed = parseMessageResponse(apiResult.data, channelId);
	if (!parsed) {
		return { output: null, durationMs: 0, error: "Slack response missing message timestamp" };
	}
	return {
		output: { status: "sent", ...parsed, reflection, message_type: messageType },
		durationMs: 0,
	};
}

interface SendMessageArgs {
	channelId: string;
	text: string;
	reflection: string;
	threadTs: string | undefined;
	replaceMessageTs: string | undefined;
	messageType: string;
	blocks: unknown[];
}

function parseSendMessageArgs(args: Record<string, unknown>): SendMessageArgs {
	const channelId = resolveChannelId(args);
	const text = getRequiredString(args, "text");
	const messageType = getOptionalString(args, "message_type") ?? "regular";
	const permissionRequestDraftIds = Array.isArray(args.permission_request_draft_ids)
		? args.permission_request_draft_ids.filter((id): id is string => typeof id === "string")
		: undefined;
	const detailedApprovalContext = getOptionalString(args, "detailed_approval_context");
	const inputBlocks = Array.isArray(args.blocks) ? args.blocks : [];
	const blocks =
		messageType === "permission_request"
			? buildPermissionRequestBlocks(
					text,
					permissionRequestDraftIds?.[0] ?? `perm_${Date.now()}`,
					detailedApprovalContext,
					inputBlocks,
				)
			: inputBlocks;
	return {
		channelId,
		text,
		reflection: getRequiredString(args, "reflection"),
		threadTs: getOptionalString(args, "thread_ts"),
		replaceMessageTs: getOptionalString(args, "replace_message_ts"),
		messageType,
		blocks,
	};
}

function createCoworkerSendSlackMessageExecutor(slackToken: string): ToolExecutor {
	return async (args) => {
		try {
			const doSend = args.do_send;
			if (typeof doSend !== "boolean") {
				throw new Error("Invalid or missing required argument: do_send");
			}
			const parsed = parseSendMessageArgs(args);
			if (!doSend) {
				return {
					output: {
						status: "suppressed",
						reflection: parsed.reflection,
						channel_id: parsed.channelId,
					},
					durationMs: 0,
				};
			}
			const params = buildSendParams(parsed.channelId, parsed.text, parsed.threadTs, parsed.blocks);
			if (parsed.replaceMessageTs) {
				return execUpdateMessage(
					slackToken,
					params,
					parsed.replaceMessageTs,
					parsed.channelId,
					parsed.reflection,
				);
			}
			return execPostMessage(
				slackToken,
				params,
				parsed.channelId,
				parsed.reflection,
				parsed.messageType,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

function createCoworkerSlackReactExecutor(slackToken: string): ToolExecutor {
	return async (args) => {
		try {
			const channel = getRequiredString(args, "channel");
			const timestamp = getRequiredString(args, "timestamp");
			const emoji = getRequiredString(args, "emoji");
			if (emoji.includes(":")) {
				return { output: null, durationMs: 0, error: "Emoji must not include colons" };
			}

			const apiResult = await slackApiCall(slackToken, "reactions.add", {
				channel,
				timestamp,
				name: emoji,
			});
			if (!apiResult.ok) {
				return { output: null, durationMs: 0, error: apiResult.error };
			}

			return {
				output: { ok: true },
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

function createCoworkerDeleteSlackMessageExecutor(slackToken: string): ToolExecutor {
	return async (args) => {
		try {
			const channel = getRequiredString(args, "channel");
			const timestamp = getRequiredString(args, "timestamp");

			const apiResult = await slackApiCall(slackToken, "chat.delete", {
				channel,
				ts: timestamp,
			});
			if (!apiResult.ok) {
				return { output: null, durationMs: 0, error: apiResult.error };
			}

			return {
				output: { ok: true },
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

function createCoworkerUpdateSlackMessageExecutor(slackToken: string): ToolExecutor {
	return async (args) => {
		try {
			const channel = getRequiredString(args, "channel");
			const timestamp = getRequiredString(args, "timestamp");
			const text = getRequiredString(args, "text");
			const blocks = args.blocks;

			const params: Record<string, string> = { channel, ts: timestamp, text };
			if (Array.isArray(blocks) && blocks.length > 0) {
				params.blocks = JSON.stringify(blocks);
			}

			const apiResult = await slackApiCall(slackToken, "chat.update", params);
			if (!apiResult.ok) {
				return { output: null, durationMs: 0, error: apiResult.error };
			}

			return {
				output: { ok: true, ts: timestamp },
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

function createCoworkerUploadToSlackExecutor(slackToken: string): ToolExecutor {
	return async (args, ctx) => {
		try {
			const { channel, filePath, filename, title } = parseUploadToSlackArgs(args);
			const absolutePath = resolveSafePath(ctx.workspaceDir, filePath);
			const content = await readFile(absolutePath);

			const initUpload = await slackApiCall(slackToken, "files.getUploadURLExternal", {
				filename,
				length: String(content.byteLength),
			});
			if (!initUpload.ok) {
				return { output: null, durationMs: 0, error: initUpload.error };
			}

			const { uploadUrl, fileId } = parseUploadInitData(initUpload.data);
			await uploadContentToSlack(uploadUrl, content);

			const completeUpload = await slackApiCall(slackToken, "files.completeUploadExternal", {
				files: JSON.stringify([{ id: fileId, title }]),
				channel_id: channel,
			});
			if (!completeUpload.ok) {
				return { output: null, durationMs: 0, error: completeUpload.error };
			}

			return {
				output: {
					file_id: fileId,
					permalink: extractUploadPermalink(completeUpload.data),
				},
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}
function isSlackHostname(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.protocol === "https:" &&
			(parsed.hostname === "files.slack.com" || parsed.hostname.endsWith(".slack.com"))
		);
	} catch {
		return false;
	}
}

function createCoworkerDownloadFromSlackExecutor(slackToken: string): ToolExecutor {
	return async (args, ctx) => {
		try {
			const url = getRequiredString(args, "url");
			const savePath = getRequiredString(args, "save_path");

			if (!isSlackHostname(url)) {
				return {
					output: null,
					durationMs: 0,
					error: "URL must be an https://*.slack.com address",
				};
			}

			const response = await fetch(url, {
				headers: {
					Authorization: `Bearer ${slackToken}`,
				},
			});
			if (!response.ok) {
				return {
					output: null,
					durationMs: 0,
					error: `Download failed with HTTP ${response.status}: ${response.statusText}`,
				};
			}

			const absolutePath = resolveSafePath(ctx.workspaceDir, savePath);
			await mkdir(path.dirname(absolutePath), { recursive: true });
			const bytes = Buffer.from(await response.arrayBuffer());
			await writeFile(absolutePath, bytes);

			return {
				output: { bytes_written: bytes.byteLength, path: savePath },
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

function createCreateThreadExecutor(slackToken: string): ToolExecutor {
	return async (args) => {
		try {
			const channel = getRequiredString(args, "channel");
			const text = getRequiredString(args, "text");

			const apiResult = await slackApiCall(slackToken, "chat.postMessage", {
				channel,
				text,
			});
			if (!apiResult.ok) {
				return { output: null, durationMs: 0, error: apiResult.error };
			}

			const ts = typeof apiResult.data.ts === "string" ? apiResult.data.ts : "";
			const responseChannel =
				typeof apiResult.data.channel === "string" ? apiResult.data.channel : channel;
			if (!ts) {
				return { output: null, durationMs: 0, error: "Slack response missing message timestamp" };
			}

			return {
				output: {
					ts,
					channel: responseChannel,
					thread_ts: ts,
				},
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

function createSendMessageToThreadExecutor(slackToken: string): ToolExecutor {
	return async (args) => {
		try {
			const channel = getRequiredString(args, "channel");
			const threadTs = getRequiredString(args, "thread_ts");
			const text = getRequiredString(args, "text");

			const apiResult = await slackApiCall(slackToken, "chat.postMessage", {
				channel,
				thread_ts: threadTs,
				text,
			});
			if (!apiResult.ok) {
				return { output: null, durationMs: 0, error: apiResult.error };
			}

			const ts = typeof apiResult.data.ts === "string" ? apiResult.data.ts : "";
			const responseChannel =
				typeof apiResult.data.channel === "string" ? apiResult.data.channel : channel;
			if (!ts) {
				return { output: null, durationMs: 0, error: "Slack response missing message timestamp" };
			}

			return {
				output: {
					ts,
					channel: responseChannel,
					thread_ts: threadTs,
				},
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

function createWaitForPathsExecutor(): ToolExecutor {
	return async (args, ctx: ToolExecutionContext) => {
		try {
			const { inputPaths, timeoutMs, pollIntervalMs } = parseWaitForPathsArgs(args);
			const targets = resolveWaitForPathTargets(ctx.workspaceDir, inputPaths);
			const { found, elapsedMs } = await waitForResolvedPathTargets(
				targets,
				timeoutMs,
				pollIntervalMs,
			);

			const foundList = inputPaths.filter((targetPath) => found.has(targetPath));
			const missingList = inputPaths.filter((targetPath) => !found.has(targetPath));

			return {
				output: {
					found: foundList,
					missing: missingList,
					elapsed_ms: elapsedMs,
				},
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}
export function createSlackToolExecutors(slackToken: string): {
	[key in SlackToolName]: ToolExecutor;
} {
	return {
		coworker_slack_history: createCoworkerSlackHistoryExecutor(slackToken),
		coworker_send_slack_message: createCoworkerSendSlackMessageExecutor(slackToken),
		coworker_slack_react: createCoworkerSlackReactExecutor(slackToken),
		coworker_delete_slack_message: createCoworkerDeleteSlackMessageExecutor(slackToken),
		coworker_update_slack_message: createCoworkerUpdateSlackMessageExecutor(slackToken),
		coworker_upload_to_slack: createCoworkerUploadToSlackExecutor(slackToken),
		coworker_download_from_slack: createCoworkerDownloadFromSlackExecutor(slackToken),
		create_thread: createCreateThreadExecutor(slackToken),
		send_message_to_thread: createSendMessageToThreadExecutor(slackToken),
		wait_for_paths: createWaitForPathsExecutor(),
	};
}
