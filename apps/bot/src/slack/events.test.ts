import { describe, expect, it, vi } from "vitest";
import type { BotContext } from "./events.js";
import { registerEventHandlers } from "./events.js";

function makeApp() {
	return {
		event: vi.fn(),
	};
}

function makeContext() {
	const runMock = vi.fn();
	const ctx: BotContext = {
		prisma: {} as never,
		runner: { run: runMock } as never,
		logger: {
			info: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as never,
	};
	return { ctx, runMock };
}

describe("registerEventHandlers", () => {
	it("registers app_mention event handler", () => {
		const app = makeApp();
		const { ctx } = makeContext();

		registerEventHandlers(app as never, ctx);

		const calls = app.event.mock.calls.map((c: unknown[]) => c[0]);
		expect(calls).toContain("app_mention");
	});

	it("registers message event handler", () => {
		const app = makeApp();
		const { ctx } = makeContext();

		registerEventHandlers(app as never, ctx);

		const calls = app.event.mock.calls.map((c: unknown[]) => c[0]);
		expect(calls).toContain("message");
	});

	it("app_mention handler returns early without required context", async () => {
		const app = makeApp();
		const { ctx } = makeContext();

		registerEventHandlers(app as never, ctx);

		const mentionCall = app.event.mock.calls.find((c: unknown[]) => c[0] === "app_mention");
		expect(mentionCall).toBeDefined();
		const handler = mentionCall?.[1] as (args: Record<string, unknown>) => Promise<void>;

		await handler({
			event: { channel: "C123", user: "U456", text: "hello bot", ts: "123.456" },
			say: vi.fn(),
			context: { teamId: undefined, botUserId: undefined, botToken: undefined },
			client: {},
		});

		expect(ctx.logger.error).toHaveBeenCalled();
	});

	it("message handler ignores non-DM, non-thread messages", async () => {
		const app = makeApp();
		const { ctx, runMock } = makeContext();

		registerEventHandlers(app as never, ctx);

		const messageCall = app.event.mock.calls.find((c: unknown[]) => c[0] === "message");
		const handler = messageCall?.[1] as (args: Record<string, unknown>) => Promise<void>;

		await handler({
			event: {
				channel: "C123",
				channel_type: "channel",
				user: "U456",
				text: "public message",
				ts: "123.456",
			},
			say: vi.fn(),
			context: {},
			client: {},
		});

		expect(runMock).not.toHaveBeenCalled();
	});

	it("message handler ignores messages without text", async () => {
		const app = makeApp();
		const { ctx, runMock } = makeContext();

		registerEventHandlers(app as never, ctx);

		const messageCall = app.event.mock.calls.find((c: unknown[]) => c[0] === "message");
		const handler = messageCall?.[1] as (args: Record<string, unknown>) => Promise<void>;

		await handler({
			event: {
				channel: "D789",
				channel_type: "im",
				user: "U456",
				ts: "123.456",
			},
			say: vi.fn(),
			context: {},
			client: {},
		});

		expect(runMock).not.toHaveBeenCalled();
	});

	it("message handler ignores bot messages (subtype)", async () => {
		const app = makeApp();
		const { ctx, runMock } = makeContext();

		registerEventHandlers(app as never, ctx);

		const messageCall = app.event.mock.calls.find((c: unknown[]) => c[0] === "message");
		const handler = messageCall?.[1] as (args: Record<string, unknown>) => Promise<void>;

		await handler({
			event: {
				channel: "D789",
				channel_type: "im",
				user: "U456",
				text: "bot message",
				ts: "123.456",
				subtype: "bot_message",
			},
			say: vi.fn(),
			context: {},
			client: {},
		});

		expect(runMock).not.toHaveBeenCalled();
	});

	it("message handler ignores messages with bot_id", async () => {
		const app = makeApp();
		const { ctx, runMock } = makeContext();

		registerEventHandlers(app as never, ctx);

		const messageCall = app.event.mock.calls.find((c: unknown[]) => c[0] === "message");
		const handler = messageCall?.[1] as (args: Record<string, unknown>) => Promise<void>;

		await handler({
			event: {
				channel: "D789",
				channel_type: "im",
				user: "U456",
				text: "from a bot",
				ts: "123.456",
				bot_id: "B123",
			},
			say: vi.fn(),
			context: {},
			client: {},
		});

		expect(runMock).not.toHaveBeenCalled();
	});

	it("message handler ignores thread replies when no existing thread in DB", async () => {
		const app = makeApp();
		const { ctx, runMock } = makeContext();
		const findFirstMock = vi.fn().mockResolvedValue(null);
		(ctx.prisma as unknown as Record<string, unknown>).thread = { findFirst: findFirstMock };

		registerEventHandlers(app as never, ctx);

		const messageCall = app.event.mock.calls.find((c: unknown[]) => c[0] === "message");
		const handler = messageCall?.[1] as (args: Record<string, unknown>) => Promise<void>;

		await handler({
			event: {
				channel: "C123",
				channel_type: "channel",
				user: "U456",
				text: "thread reply",
				ts: "999.999",
				thread_ts: "111.111",
			},
			say: vi.fn(),
			context: { teamId: "T1", botUserId: "BOTU", botToken: "xoxb-token" },
			client: {},
		});

		expect(findFirstMock).toHaveBeenCalledWith({
			where: {
				workspace: { slackTeamId: "T1" },
				slackChannel: "C123",
				slackThreadTs: "111.111",
			},
		});
		expect(runMock).not.toHaveBeenCalled();
	});
});
