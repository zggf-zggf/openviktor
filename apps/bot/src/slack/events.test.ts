import { describe, expect, it, vi } from "vitest";
import { registerEventHandlers } from "./events.js";

function makeApp() {
	return {
		event: vi.fn(),
	};
}

function makeLogger() {
	return {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

describe("registerEventHandlers", () => {
	it("registers app_mention event handler", () => {
		const app = makeApp();
		const logger = makeLogger();

		registerEventHandlers(app as never, logger as never);

		const calls = app.event.mock.calls.map((c: unknown[]) => c[0]);
		expect(calls).toContain("app_mention");
	});

	it("registers message event handler", () => {
		const app = makeApp();
		const logger = makeLogger();

		registerEventHandlers(app as never, logger as never);

		const calls = app.event.mock.calls.map((c: unknown[]) => c[0]);
		expect(calls).toContain("message");
	});

	it("app_mention handler logs correct fields", async () => {
		const app = makeApp();
		const logger = makeLogger();

		registerEventHandlers(app as never, logger as never);

		const mentionCall = app.event.mock.calls.find((c: unknown[]) => c[0] === "app_mention");
		expect(mentionCall).toBeDefined();
		const handler = mentionCall?.[1] as (args: { event: Record<string, unknown> }) => Promise<void>;

		const event = {
			channel: "C123",
			user: "U456",
			text: "hello bot",
			ts: "1234567890.000001",
			event_ts: "1234567890.000001",
		};

		await handler({ event });

		expect(logger.info).toHaveBeenCalledOnce();
		const logArg = logger.info.mock.calls[0][0];
		expect(logArg).toMatchObject({
			event: "app_mention",
			channel: "C123",
			user: "U456",
			text: "hello bot",
			ts: "1234567890.000001",
			eventId: "1234567890.000001",
		});
	});

	it("message handler logs DM events (channel_type = im)", async () => {
		const app = makeApp();
		const logger = makeLogger();

		registerEventHandlers(app as never, logger as never);

		const messageCall = app.event.mock.calls.find((c: unknown[]) => c[0] === "message");
		expect(messageCall).toBeDefined();
		const handler = messageCall?.[1] as (args: { event: Record<string, unknown> }) => Promise<void>;

		const event = {
			channel: "D789",
			channel_type: "im",
			user: "U456",
			text: "direct message",
			ts: "1234567890.000002",
			event_ts: "1234567890.000002",
		};

		await handler({ event });

		expect(logger.info).toHaveBeenCalledOnce();
		const logArg = logger.info.mock.calls[0][0];
		expect(logArg).toMatchObject({
			event: "message_im",
			channel: "D789",
			user: "U456",
			text: "direct message",
		});
	});

	it("message handler ignores non-DM messages", async () => {
		const app = makeApp();
		const logger = makeLogger();

		registerEventHandlers(app as never, logger as never);

		const messageCall = app.event.mock.calls.find((c: unknown[]) => c[0] === "message");
		const handler = messageCall?.[1] as (args: { event: Record<string, unknown> }) => Promise<void>;

		const event = {
			channel: "C123",
			channel_type: "channel",
			user: "U456",
			text: "public message",
			ts: "1234567890.000003",
			event_ts: "1234567890.000003",
		};

		await handler({ event });

		expect(logger.info).not.toHaveBeenCalled();
	});
});
