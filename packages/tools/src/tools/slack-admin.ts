import type { LLMToolDefinition, ToolResult } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";

type SlackMethod =
	| "conversations.list"
	| "conversations.join"
	| "conversations.open"
	| "conversations.leave"
	| "users.list"
	| "conversations.invite"
	| "reactions.get"
	| "chat.postMessage";

interface SlackResponse {
	ok: boolean;
	error?: string;
	response_metadata?: {
		next_cursor?: string;
	};
	channels?: Array<{
		id: string;
		name: string;
		is_private: boolean;
		num_members?: number;
	}>;
	channel?:
		| {
				id: string;
		  }
		| string;
	members?: Array<{
		id: string;
		name?: string;
		real_name?: string;
		is_bot?: boolean;
	}>;
	message?: {
		ts?: string;
		reactions?: Array<{
			name: string;
			count: number;
			users: string[];
		}>;
	};
	ts?: string;
}

const SEVERITY_EMOJI: Record<"low" | "medium" | "high", string> = {
	low: "🟢",
	medium: "🟡",
	high: "🔴",
};

function getNextCursor(response: SlackResponse): string | undefined {
	const nextCursor = response.response_metadata?.next_cursor;
	if (!nextCursor || nextCursor.trim().length === 0) {
		return undefined;
	}
	return nextCursor;
}

async function callSlackApi(
	slackToken: string,
	method: SlackMethod,
	body: Record<string, unknown>,
): Promise<SlackResponse> {
	const response = await fetch(`https://slack.com/api/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${slackToken}`,
			"Content-Type": "application/json; charset=utf-8",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		throw new Error(`Slack API HTTP ${response.status} for ${method}`);
	}

	const data = (await response.json()) as SlackResponse;
	if (!data.ok) {
		throw new Error(data.error ?? `Slack API error for ${method}`);
	}

	return data;
}

export const coworkerListSlackChannelsDefinition: LLMToolDefinition = {
	name: "coworker_list_slack_channels",
	description: "List Slack channels visible to the bot.",
	input_schema: {
		type: "object",
		properties: {
			types: {
				type: "string",
				description:
					'Comma-separated channel types for conversations.list (default: "public_channel,private_channel")',
			},
			limit: {
				type: "number",
				description: "Maximum number of channels to return (default: 200)",
			},
		},
	},
};

export function createCoworkerListSlackChannelsExecutor(slackToken: string): ToolExecutor {
	return async (args): Promise<ToolResult> => {
		try {
			const types =
				typeof args.types === "string" && args.types.trim().length > 0
					? args.types
					: "public_channel,private_channel";
			const limit = typeof args.limit === "number" ? args.limit : 200;

			const response = await callSlackApi(slackToken, "conversations.list", { types, limit });
			const channels = (response.channels ?? []).map((channel) => ({
				id: channel.id,
				name: channel.name,
				is_private: channel.is_private,
				num_members: channel.num_members,
			}));
			const nextCursor = getNextCursor(response);

			return {
				output: nextCursor ? { channels, next_cursor: nextCursor } : { channels },
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

export const coworkerJoinSlackChannelsDefinition: LLMToolDefinition = {
	name: "coworker_join_slack_channels",
	description: "Join one or more Slack channels.",
	input_schema: {
		type: "object",
		properties: {
			channel_ids: {
				type: "array",
				items: { type: "string" },
				description: "Channel IDs to join",
			},
		},
		required: ["channel_ids"],
	},
};

export function createCoworkerJoinSlackChannelsExecutor(slackToken: string): ToolExecutor {
	return async (args): Promise<ToolResult> => {
		try {
			if (
				!Array.isArray(args.channel_ids) ||
				args.channel_ids.some((id) => typeof id !== "string")
			) {
				throw new Error("channel_ids must be an array of strings");
			}

			const channelIds = args.channel_ids as string[];
			const results = await Promise.all(
				channelIds.map(async (channelId) => {
					try {
						await callSlackApi(slackToken, "conversations.join", { channel: channelId });
						return { channelId, ok: true };
					} catch {
						return { channelId, ok: false };
					}
				}),
			);

			return {
				output: {
					joined: results.filter((result) => result.ok).map((result) => result.channelId),
					failed: results.filter((result) => !result.ok).map((result) => result.channelId),
				},
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

export const coworkerOpenSlackConversationDefinition: LLMToolDefinition = {
	name: "coworker_open_slack_conversation",
	description: "Open a Slack DM or group DM conversation.",
	input_schema: {
		type: "object",
		properties: {
			user_ids: {
				type: "array",
				items: { type: "string" },
				description: "User IDs to include in the conversation",
			},
		},
		required: ["user_ids"],
	},
};

export function createCoworkerOpenSlackConversationExecutor(slackToken: string): ToolExecutor {
	return async (args): Promise<ToolResult> => {
		try {
			if (!Array.isArray(args.user_ids) || args.user_ids.some((id) => typeof id !== "string")) {
				throw new Error("user_ids must be an array of strings");
			}

			const users = (args.user_ids as string[]).join(",");
			const response = await callSlackApi(slackToken, "conversations.open", { users });
			const channelId =
				typeof response.channel === "string" ? response.channel : response.channel?.id;
			if (!channelId) {
				throw new Error("Slack response missing channel id");
			}
			return { output: { channel_id: channelId }, durationMs: 0 };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

export const coworkerLeaveSlackChannelsDefinition: LLMToolDefinition = {
	name: "coworker_leave_slack_channels",
	description: "Leave one or more Slack channels.",
	input_schema: {
		type: "object",
		properties: {
			channel_ids: {
				type: "array",
				items: { type: "string" },
				description: "Channel IDs to leave",
			},
		},
		required: ["channel_ids"],
	},
};

export function createCoworkerLeaveSlackChannelsExecutor(slackToken: string): ToolExecutor {
	return async (args): Promise<ToolResult> => {
		try {
			if (
				!Array.isArray(args.channel_ids) ||
				args.channel_ids.some((id) => typeof id !== "string")
			) {
				throw new Error("channel_ids must be an array of strings");
			}

			const channelIds = args.channel_ids as string[];
			const results = await Promise.all(
				channelIds.map(async (channelId) => {
					try {
						await callSlackApi(slackToken, "conversations.leave", { channel: channelId });
						return { channelId, ok: true };
					} catch {
						return { channelId, ok: false };
					}
				}),
			);

			return {
				output: {
					left: results.filter((result) => result.ok).map((result) => result.channelId),
					failed: results.filter((result) => !result.ok).map((result) => result.channelId),
				},
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

export const coworkerListSlackUsersDefinition: LLMToolDefinition = {
	name: "coworker_list_slack_users",
	description: "List Slack users visible to the bot.",
	input_schema: {
		type: "object",
		properties: {
			limit: {
				type: "number",
				description: "Maximum number of users to return (default: 200)",
			},
		},
	},
};

export function createCoworkerListSlackUsersExecutor(slackToken: string): ToolExecutor {
	return async (args): Promise<ToolResult> => {
		try {
			const limit = typeof args.limit === "number" ? args.limit : 200;
			const response = await callSlackApi(slackToken, "users.list", { limit });
			const members = (response.members ?? []).map((member) => ({
				id: member.id,
				name: member.name ?? "",
				real_name: member.real_name ?? "",
				is_bot: member.is_bot ?? false,
			}));
			const nextCursor = getNextCursor(response);

			return {
				output: nextCursor ? { members, next_cursor: nextCursor } : { members },
				durationMs: 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

export const coworkerInviteSlackUserToTeamDefinition: LLMToolDefinition = {
	name: "coworker_invite_slack_user_to_team",
	description: "Invite a Slack user to a channel.",
	input_schema: {
		type: "object",
		properties: {
			channel_id: {
				type: "string",
				description: "Channel ID",
			},
			user_id: {
				type: "string",
				description: "User ID",
			},
		},
		required: ["channel_id", "user_id"],
	},
};

export function createCoworkerInviteSlackUserToTeamExecutor(slackToken: string): ToolExecutor {
	return async (args): Promise<ToolResult> => {
		try {
			if (typeof args.channel_id !== "string" || args.channel_id.trim().length === 0) {
				throw new Error("channel_id must be a non-empty string");
			}
			if (typeof args.user_id !== "string" || args.user_id.trim().length === 0) {
				throw new Error("user_id must be a non-empty string");
			}

			await callSlackApi(slackToken, "conversations.invite", {
				channel: args.channel_id,
				users: args.user_id,
			});

			return { output: { ok: true }, durationMs: 0 };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

export const coworkerGetSlackReactionsDefinition: LLMToolDefinition = {
	name: "coworker_get_slack_reactions",
	description: "Get reactions for a Slack message.",
	input_schema: {
		type: "object",
		properties: {
			channel: {
				type: "string",
				description: "Channel ID",
			},
			timestamp: {
				type: "string",
				description: "Slack message timestamp",
			},
		},
		required: ["channel", "timestamp"],
	},
};

export function createCoworkerGetSlackReactionsExecutor(slackToken: string): ToolExecutor {
	return async (args): Promise<ToolResult> => {
		try {
			if (typeof args.channel !== "string" || args.channel.trim().length === 0) {
				throw new Error("channel must be a non-empty string");
			}
			if (typeof args.timestamp !== "string" || args.timestamp.trim().length === 0) {
				throw new Error("timestamp must be a non-empty string");
			}

			const response = await callSlackApi(slackToken, "reactions.get", {
				channel: args.channel,
				timestamp: args.timestamp,
			});

			const reactions = (response.message?.reactions ?? []).map((reaction) => ({
				name: reaction.name,
				count: reaction.count,
				users: reaction.users,
			}));

			return { output: { reactions }, durationMs: 0 };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}

export const coworkerReportIssueDefinition: LLMToolDefinition = {
	name: "coworker_report_issue",
	description: "Post a formatted issue report to Slack.",
	input_schema: {
		type: "object",
		properties: {
			title: {
				type: "string",
				description: "Issue title",
			},
			description: {
				type: "string",
				description: "Issue description",
			},
			severity: {
				type: "string",
				enum: ["low", "medium", "high"],
				description: 'Issue severity (default: "medium")',
			},
			channel: {
				type: "string",
				description: 'Slack channel (default: "#general")',
			},
		},
		required: ["title", "description"],
	},
};

function parseRequiredIssueField(args: Record<string, unknown>, key: "title" | "description"): string {
	const value = args[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${key} must be a non-empty string`);
	}
	return value;
}

function parseIssueSeverity(value: unknown): "low" | "medium" | "high" {
	if (value === "low" || value === "medium" || value === "high") {
		return value;
	}
	return "medium";
}

function parseIssueChannel(value: unknown): string {
	if (typeof value === "string" && value.trim().length > 0) {
		return value;
	}
	return "#general";
}

function buildIssueReportText(
	title: string,
	description: string,
	severity: "low" | "medium" | "high",
): string {
	return `${SEVERITY_EMOJI[severity]} *${title}*\n\n${description}`;
}

function getPostedMessageTimestamp(response: SlackResponse): string {
	const ts = response.ts ?? response.message?.ts;
	if (!ts) {
		throw new Error("Slack response missing ts");
	}
	return ts;
}

export function createCoworkerReportIssueExecutor(slackToken: string): ToolExecutor {
	return async (args): Promise<ToolResult> => {
		try {
			const title = parseRequiredIssueField(args, "title");
			const description = parseRequiredIssueField(args, "description");
			const severity = parseIssueSeverity(args.severity);
			const channel = parseIssueChannel(args.channel);
			const text = buildIssueReportText(title, description, severity);

			const response = await callSlackApi(slackToken, "chat.postMessage", {
				channel,
				text,
			});
			const ts = getPostedMessageTimestamp(response);

			return { output: { ts, channel }, durationMs: 0 };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { output: null, durationMs: 0, error: message };
		}
	};
}
export function createSlackAdminExecutors(slackToken: string): {
	[key in
		| "coworker_list_slack_channels"
		| "coworker_join_slack_channels"
		| "coworker_open_slack_conversation"
		| "coworker_leave_slack_channels"
		| "coworker_list_slack_users"
		| "coworker_invite_slack_user_to_team"
		| "coworker_get_slack_reactions"
		| "coworker_report_issue"]: ToolExecutor;
} {
	return {
		coworker_list_slack_channels: createCoworkerListSlackChannelsExecutor(slackToken),
		coworker_join_slack_channels: createCoworkerJoinSlackChannelsExecutor(slackToken),
		coworker_open_slack_conversation: createCoworkerOpenSlackConversationExecutor(slackToken),
		coworker_leave_slack_channels: createCoworkerLeaveSlackChannelsExecutor(slackToken),
		coworker_list_slack_users: createCoworkerListSlackUsersExecutor(slackToken),
		coworker_invite_slack_user_to_team: createCoworkerInviteSlackUserToTeamExecutor(slackToken),
		coworker_get_slack_reactions: createCoworkerGetSlackReactionsExecutor(slackToken),
		coworker_report_issue: createCoworkerReportIssueExecutor(slackToken),
	};
}

export const coworkerListSlackChannelsExecutor = createCoworkerListSlackChannelsExecutor;
export const coworkerJoinSlackChannelsExecutor = createCoworkerJoinSlackChannelsExecutor;
export const coworkerOpenSlackConversationExecutor = createCoworkerOpenSlackConversationExecutor;
export const coworkerLeaveSlackChannelsExecutor = createCoworkerLeaveSlackChannelsExecutor;
export const coworkerListSlackUsersExecutor = createCoworkerListSlackUsersExecutor;
export const coworkerInviteSlackUserToTeamExecutor = createCoworkerInviteSlackUserToTeamExecutor;
export const coworkerGetSlackReactionsExecutor = createCoworkerGetSlackReactionsExecutor;
export const coworkerReportIssueExecutor = createCoworkerReportIssueExecutor;
