import type { PrismaClient } from "@openviktor/db";
import type { Logger } from "@openviktor/shared";
import type { App } from "@slack/bolt";

export interface InteractionContext {
	prisma: PrismaClient;
	logger: Logger;
}

export function registerInteractionHandlers(app: App, ctx: InteractionContext): void {
	app.action("permission_approve", async ({ action, ack, body, client }) => {
		await ack();

		const blockAction = action as { value?: string };
		const requestId = blockAction.value;
		if (!requestId) {
			ctx.logger.warn("permission_approve action missing request ID");
			return;
		}

		const userId = body.user?.id ?? "unknown";

		try {
			const result = await ctx.prisma.permissionRequest.updateMany({
				where: { id: requestId, status: "PENDING", expiresAt: { gt: new Date() } },
				data: {
					status: "APPROVED",
					approvedBy: userId,
					resolvedAt: new Date(),
				},
			});

			const request = await ctx.prisma.permissionRequest.findUnique({
				where: { id: requestId },
			});

			if (result.count === 0) {
				const status = request?.status ?? "unknown";
				await updateMessage(
					client,
					request?.slackChannel ?? null,
					request?.slackMessageTs ?? null,
					status === "PENDING"
						? "Permission request expired."
						: `Permission request already ${status.toLowerCase()}.`,
				);
				return;
			}

			await updateMessage(
				client,
				request?.slackChannel ?? null,
				request?.slackMessageTs ?? null,
				`Approved by <@${userId}>. Executing \`${request?.toolName}\`...`,
			);

			ctx.logger.info({ requestId, userId }, "Permission approved");
		} catch (error) {
			ctx.logger.error({ requestId, err: error }, "Failed to approve permission");
		}
	});

	app.action("permission_reject", async ({ action, ack, body, client }) => {
		await ack();

		const blockAction = action as { value?: string };
		const requestId = blockAction.value;
		if (!requestId) {
			ctx.logger.warn("permission_reject action missing request ID");
			return;
		}

		const userId = body.user?.id ?? "unknown";

		try {
			const result = await ctx.prisma.permissionRequest.updateMany({
				where: { id: requestId, status: "PENDING" },
				data: {
					status: "REJECTED",
					approvedBy: userId,
					resolvedAt: new Date(),
				},
			});

			const request = await ctx.prisma.permissionRequest.findUnique({
				where: { id: requestId },
			});

			if (result.count === 0) {
				const status = request?.status ?? "unknown";
				await updateMessage(
					client,
					request?.slackChannel ?? null,
					request?.slackMessageTs ?? null,
					`Permission request already ${status.toLowerCase()}.`,
				);
				return;
			}

			await updateMessage(
				client,
				request?.slackChannel ?? null,
				request?.slackMessageTs ?? null,
				`Rejected by <@${userId}>.`,
			);

			ctx.logger.info({ requestId, userId }, "Permission rejected");
		} catch (error) {
			ctx.logger.error({ requestId, err: error }, "Failed to reject permission");
		}
	});
}

async function updateMessage(
	client: unknown,
	channel: string | null,
	ts: string | null,
	text: string,
): Promise<void> {
	if (!channel || !ts) return;
	try {
		const slackClient = client as {
			chat: {
				update: (opts: {
					channel: string;
					ts: string;
					text: string;
					blocks: never[];
				}) => Promise<unknown>;
			};
		};
		await slackClient.chat.update({ channel, ts, text, blocks: [] });
	} catch {
		// Best-effort message update
	}
}

export function buildPermissionMessage(
	requestId: string,
	toolName: string,
	toolInput: unknown,
): { text: string; blocks: unknown[] } {
	const inputSummary =
		typeof toolInput === "object" && toolInput !== null
			? Object.entries(toolInput as Record<string, unknown>)
					.filter(([k]) => !k.startsWith("_"))
					.map(([k, v]) => `  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
					.join("\n")
			: String(toolInput);

	const text = `Permission requested: ${toolName}`;

	const blocks = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `:lock: *Permission Required*\n\nTool: \`${toolName}\`\n\`\`\`\n${inputSummary}\n\`\`\``,
			},
		},
		{
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
		},
	];

	return { text, blocks };
}
