import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEventsApiHandler } from "../slack/events-api.js";
import type { ConnectionManager, EventHandler, SlackConnection } from "../slack/connection-manager.js";

const SIGNING_SECRET = "test-signing-secret";

function signRequest(body: string, secret = SIGNING_SECRET): { timestamp: string; signature: string } {
	const timestamp = Math.floor(Date.now() / 1000).toString();
	const sigBasestring = `v0:${timestamp}:${body}`;
	const hmac = createHmac("sha256", secret).update(sigBasestring).digest("hex");
	return { timestamp, signature: `v0=${hmac}` };
}

function createMockRequest(body: string, headers: Record<string, string> = {}): Request {
	const { timestamp, signature } = signRequest(body);
	return new Request("http://localhost/slack/events", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-slack-request-timestamp": headers["x-slack-request-timestamp"] ?? timestamp,
			"x-slack-signature": headers["x-slack-signature"] ?? signature,
		},
		body,
	});
}

const mockLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
} as never;

describe("Events API Handler", () => {
	let onEvent: EventHandler;
	let mockConnection: SlackConnection;
	let connectionManager: ConnectionManager;

	beforeEach(() => {
		vi.clearAllMocks();
		onEvent = vi.fn().mockResolvedValue(undefined);

		mockConnection = {
			workspaceId: "ws-1",
			teamId: "T123",
			botUserId: "U_BOT",
			getClient: vi.fn().mockReturnValue({
				chat: { postMessage: vi.fn().mockResolvedValue({ ok: true }) },
				token: "xoxb-test",
			}),
			isConnected: vi.fn().mockReturnValue(true),
			start: vi.fn(),
			stop: vi.fn(),
		} as never;

		connectionManager = {
			getConnectionByTeamId: vi.fn().mockImplementation((teamId: string) => {
				if (teamId === "T123") return mockConnection;
				return undefined;
			}),
		} as never;
	});

	it("handles URL verification challenge", async () => {
		const handler = createEventsApiHandler({
			signingSecret: SIGNING_SECRET,
			connectionManager,
			onEvent,
			logger: mockLogger,
		});

		const body = JSON.stringify({
			type: "url_verification",
			challenge: "abc123",
		});
		const req = createMockRequest(body);
		const res = await handler.handleEventsRequest(req);
		const json = (await res.json()) as { challenge: string };
		expect(json.challenge).toBe("abc123");
	});

	it("rejects requests with invalid signature", async () => {
		const handler = createEventsApiHandler({
			signingSecret: SIGNING_SECRET,
			connectionManager,
			onEvent,
			logger: mockLogger,
		});

		const body = JSON.stringify({ type: "event_callback", team_id: "T123" });
		const req = createMockRequest(body, { "x-slack-signature": "v0=invalid" });
		const res = await handler.handleEventsRequest(req);
		expect(res.status).toBe(401);
	});

	it("routes events to correct workspace connection", async () => {
		const handler = createEventsApiHandler({
			signingSecret: SIGNING_SECRET,
			connectionManager,
			onEvent,
			logger: mockLogger,
		});

		const body = JSON.stringify({
			type: "event_callback",
			team_id: "T123",
			event: {
				type: "app_mention",
				channel: "C123",
				user: "U456",
				text: "<@U_BOT> hello",
				ts: "1234567890.123456",
			},
		});
		const req = createMockRequest(body);
		const res = await handler.handleEventsRequest(req);
		expect(res.status).toBe(200);

		// Give async handler time to fire
		await new Promise((r) => setTimeout(r, 50));
		expect(onEvent).toHaveBeenCalledTimes(1);
		const call = (onEvent as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(call[0].type).toBe("app_mention");
		expect(call[0].teamId).toBe("T123");
		expect(call[0].channel).toBe("C123");
	});

	it("returns 200 for unknown team (drops event)", async () => {
		const handler = createEventsApiHandler({
			signingSecret: SIGNING_SECRET,
			connectionManager,
			onEvent,
			logger: mockLogger,
		});

		const body = JSON.stringify({
			type: "event_callback",
			team_id: "T_UNKNOWN",
			event: { type: "message", channel: "C1", ts: "1" },
		});
		const req = createMockRequest(body);
		const res = await handler.handleEventsRequest(req);
		expect(res.status).toBe(200);
		await new Promise((r) => setTimeout(r, 50));
		expect(onEvent).not.toHaveBeenCalled();
	});

	it("maps message events correctly", async () => {
		const handler = createEventsApiHandler({
			signingSecret: SIGNING_SECRET,
			connectionManager,
			onEvent,
			logger: mockLogger,
		});

		const body = JSON.stringify({
			type: "event_callback",
			team_id: "T123",
			event: {
				type: "message",
				channel: "D123",
				user: "U789",
				text: "hello bot",
				ts: "111.222",
				thread_ts: "111.000",
				channel_type: "im",
			},
		});
		const req = createMockRequest(body);
		await handler.handleEventsRequest(req);
		await new Promise((r) => setTimeout(r, 50));

		expect(onEvent).toHaveBeenCalledTimes(1);
		const event = (onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(event.type).toBe("message");
		expect(event.channelType).toBe("im");
		expect(event.threadTs).toBe("111.000");
	});
});
