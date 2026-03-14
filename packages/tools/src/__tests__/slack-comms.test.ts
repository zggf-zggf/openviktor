import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../registry.js";
import {
	coworkerSendSlackMessageDefinition,
	createSlackToolExecutors,
} from "../tools/slack-comms.js";

const FAKE_TOKEN = "xoxb-test-token";
const ctx: ToolExecutionContext = {
	workspaceId: "ws_test",
	workspaceDir: "/tmp/test",
	timeoutMs: 30_000,
};

const mockFetch = vi.fn();

beforeEach(() => {
	vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function mockSlackResponse(data: Record<string, unknown>) {
	mockFetch.mockResolvedValueOnce({
		ok: true,
		json: async () => ({ ok: true, ...data }),
	});
}

describe("coworker_send_slack_message", () => {
	describe("definition", () => {
		it("requires channel_id, text, reflection, and do_send", () => {
			const required = coworkerSendSlackMessageDefinition.input_schema.required;
			expect(required).toContain("channel_id");
			expect(required).toContain("text");
			expect(required).toContain("reflection");
			expect(required).toContain("do_send");
		});

		it("includes message_type enum", () => {
			const props = coworkerSendSlackMessageDefinition.input_schema.properties as Record<
				string,
				// biome-ignore lint/suspicious/noExplicitAny: test introspection
				any
			>;
			expect(props.message_type.enum).toEqual(["regular", "permission_request"]);
		});
	});

	describe("reflection gate", () => {
		it("suppresses message when do_send is false", async () => {
			const executors = createSlackToolExecutors(FAKE_TOKEN);
			const result = await executors.coworker_send_slack_message(
				{
					channel_id: "C123",
					text: "Hello",
					reflection: "This message is not needed",
					do_send: false,
				},
				ctx,
			);
			expect(result.error).toBeUndefined();
			const output = result.output as { status: string; reflection: string };
			expect(output.status).toBe("suppressed");
			expect(output.reflection).toBe("This message is not needed");
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("sends message when do_send is true", async () => {
			mockSlackResponse({ ts: "1234.5678", channel: "C123" });
			const executors = createSlackToolExecutors(FAKE_TOKEN);
			const result = await executors.coworker_send_slack_message(
				{
					channel_id: "C123",
					text: "Hello",
					reflection: "Message is helpful and accurate",
					do_send: true,
				},
				ctx,
			);
			expect(result.error).toBeUndefined();
			const output = result.output as { status: string; ts: string; reflection: string };
			expect(output.status).toBe("sent");
			expect(output.ts).toBe("1234.5678");
			expect(output.reflection).toBe("Message is helpful and accurate");
		});

		it("includes reflection in output even when sent", async () => {
			mockSlackResponse({ ts: "1234.5678", channel: "C123" });
			const executors = createSlackToolExecutors(FAKE_TOKEN);
			const result = await executors.coworker_send_slack_message(
				{
					channel_id: "C123",
					text: "test",
					reflection: "Looks good",
					do_send: true,
				},
				ctx,
			);
			const output = result.output as { reflection: string };
			expect(output.reflection).toBe("Looks good");
		});
	});

	describe("Block Kit", () => {
		it("passes blocks to Slack API", async () => {
			mockSlackResponse({ ts: "1234.5678", channel: "C123" });
			const executors = createSlackToolExecutors(FAKE_TOKEN);
			const blocks = [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }];
			await executors.coworker_send_slack_message(
				{
					channel_id: "C123",
					text: "fallback",
					blocks,
					reflection: "Rich formatting used appropriately",
					do_send: true,
				},
				ctx,
			);
			expect(mockFetch).toHaveBeenCalledTimes(1);
			const [, options] = mockFetch.mock.calls[0];
			const body = new URLSearchParams(options.body);
			expect(JSON.parse(body.get("blocks") ?? "null")).toEqual(blocks);
		});
	});

	describe("message replacement", () => {
		it("uses chat.update when replace_message_ts is provided", async () => {
			mockSlackResponse({ ok: true, ts: "original.ts" });
			const executors = createSlackToolExecutors(FAKE_TOKEN);
			const result = await executors.coworker_send_slack_message(
				{
					channel_id: "C123",
					text: "Updated text",
					reflection: "Updating existing message",
					do_send: true,
					replace_message_ts: "original.ts",
				},
				ctx,
			);
			expect(result.error).toBeUndefined();
			const output = result.output as { status: string; ts: string };
			expect(output.status).toBe("updated");
			expect(output.ts).toBe("original.ts");
			const [url] = mockFetch.mock.calls[0];
			expect(url).toContain("chat.update");
		});
	});

	describe("permission_request message type", () => {
		it("adds Approve/Reject action buttons", async () => {
			mockSlackResponse({ ts: "1234.5678", channel: "C123" });
			const executors = createSlackToolExecutors(FAKE_TOKEN);
			await executors.coworker_send_slack_message(
				{
					channel_id: "C123",
					text: "Permission needed",
					reflection: "This requires approval",
					do_send: true,
					message_type: "permission_request",
					permission_request_draft_ids: ["draft_abc"],
				},
				ctx,
			);
			const [, options] = mockFetch.mock.calls[0];
			const body = new URLSearchParams(options.body);
			const blocks = JSON.parse(body.get("blocks") ?? "[]");
			// biome-ignore lint/suspicious/noExplicitAny: test introspection
			const actionsBlock = blocks.find((b: any) => b.type === "actions");
			expect(actionsBlock).toBeDefined();
			expect(actionsBlock.elements).toHaveLength(2);
			expect(actionsBlock.elements[0].action_id).toBe("permission_approve");
			expect(actionsBlock.elements[0].value).toBe("draft_abc");
			expect(actionsBlock.elements[1].action_id).toBe("permission_reject");
		});

		it("includes detailed_approval_context as context block", async () => {
			mockSlackResponse({ ts: "1234.5678", channel: "C123" });
			const executors = createSlackToolExecutors(FAKE_TOKEN);
			await executors.coworker_send_slack_message(
				{
					channel_id: "C123",
					text: "Need permission",
					reflection: "Requesting permission",
					do_send: true,
					message_type: "permission_request",
					detailed_approval_context: "This will deploy to production",
				},
				ctx,
			);
			const [, options] = mockFetch.mock.calls[0];
			const body = new URLSearchParams(options.body);
			const blocks = JSON.parse(body.get("blocks") ?? "[]");
			// biome-ignore lint/suspicious/noExplicitAny: test introspection
			const contextBlock = blocks.find((b: any) => b.type === "context");
			expect(contextBlock).toBeDefined();
			expect(contextBlock.elements[0].text).toBe("This will deploy to production");
		});
	});

	describe("validation", () => {
		it("errors when do_send is not a boolean", async () => {
			const executors = createSlackToolExecutors(FAKE_TOKEN);
			const result = await executors.coworker_send_slack_message(
				{
					channel_id: "C123",
					text: "test",
					reflection: "test",
					do_send: "yes",
				},
				ctx,
			);
			expect(result.error).toContain("do_send");
		});

		it("errors when reflection is missing", async () => {
			const executors = createSlackToolExecutors(FAKE_TOKEN);
			const result = await executors.coworker_send_slack_message(
				{
					channel_id: "C123",
					text: "test",
					do_send: true,
				},
				ctx,
			);
			expect(result.error).toContain("reflection");
		});

		it("accepts channel as alias for channel_id (backwards compat)", async () => {
			mockSlackResponse({ ts: "1234.5678", channel: "C123" });
			const executors = createSlackToolExecutors(FAKE_TOKEN);
			const result = await executors.coworker_send_slack_message(
				{
					channel: "C123",
					text: "test",
					reflection: "test",
					do_send: true,
				},
				ctx,
			);
			expect(result.error).toBeUndefined();
		});
	});
});
