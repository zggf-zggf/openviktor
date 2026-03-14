import type { PrismaClient } from "@openviktor/db";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";

export const submitPermissionRequestDefinition: LLMToolDefinition = {
	name: "submit_permission_request",
	description:
		"Check status or submit an approval code for a pending permission request. Use when a tool call requires user approval.",
	input_schema: {
		type: "object",
		properties: {
			request_id: {
				type: "string",
				description: "The permission request ID to check",
			},
			approval_code: {
				type: "string",
				description: "The approval code provided by the user (optional, for manual approval)",
			},
		},
		required: ["request_id"],
	},
};

export function createSubmitPermissionRequestExecutor(prisma: PrismaClient): ToolExecutor {
	return async (args) => {
		const requestId = args.request_id as string;
		if (!requestId) {
			return { output: null, durationMs: 0, error: "request_id is required" };
		}

		const request = await prisma.permissionRequest.findUnique({
			where: { id: requestId },
		});

		if (!request) {
			return { output: null, durationMs: 0, error: "Permission request not found" };
		}

		if (request.status !== "PENDING") {
			return {
				output: {
					id: request.id,
					status: request.status,
					resolved_at: request.resolvedAt?.toISOString() ?? null,
				},
				durationMs: 0,
			};
		}

		if (new Date() >= request.expiresAt) {
			await prisma.permissionRequest.updateMany({
				where: { id: requestId, status: "PENDING" },
				data: { status: "EXPIRED" },
			});
			return {
				output: { id: request.id, status: "EXPIRED" },
				durationMs: 0,
			};
		}

		const approvalCode = args.approval_code as string | undefined;
		if (approvalCode && approvalCode === request.approvalCode) {
			const result = await prisma.permissionRequest.updateMany({
				where: { id: requestId, status: "PENDING" },
				data: {
					status: "APPROVED",
					approvedBy: "manual",
					resolvedAt: new Date(),
				},
			});
			if (result.count === 0) {
				const reloaded = await prisma.permissionRequest.findUnique({
					where: { id: requestId },
				});
				return {
					output: {
						id: request.id,
						status: reloaded?.status ?? "UNKNOWN",
					},
					durationMs: 0,
				};
			}
			return {
				output: { id: request.id, status: "APPROVED" },
				durationMs: 0,
			};
		}

		if (approvalCode) {
			return { output: null, durationMs: 0, error: "Invalid approval code" };
		}

		return {
			output: {
				id: request.id,
				status: "PENDING",
				tool_name: request.toolName,
				expires_at: request.expiresAt.toISOString(),
			},
			durationMs: 0,
		};
	};
}
