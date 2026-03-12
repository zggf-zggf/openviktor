import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBotFilter, createDeduplicator } from "./middleware.js";

type MiddlewareArgs = {
	body: Record<string, unknown>;
	payload?: Record<string, unknown>;
	ack?: () => Promise<void>;
	next: () => Promise<void>;
};

function makeArgs(overrides: Partial<MiddlewareArgs> = {}) {
	const base = {
		body: {} as Record<string, unknown>,
		payload: undefined as Record<string, unknown> | undefined,
		ack: vi.fn().mockResolvedValue(undefined) as (() => Promise<void>) | undefined,
		next: vi.fn().mockResolvedValue(undefined),
	};
	return Object.assign(base, overrides);
}

describe("createDeduplicator", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("passes through first event with a new event_id", async () => {
		const dedup = createDeduplicator();
		const args = makeArgs({ body: { event_id: "evt-001" } });

		await dedup(args as never);

		expect(args.next).toHaveBeenCalledOnce();
	});

	it("rejects duplicate event_id within TTL", async () => {
		const dedup = createDeduplicator(60_000);
		const args1 = makeArgs({ body: { event_id: "evt-dup" } });
		const args2 = makeArgs({ body: { event_id: "evt-dup" } });

		await dedup(args1 as never);
		await dedup(args2 as never);

		expect(args1.next).toHaveBeenCalledOnce();
		expect(args2.next).not.toHaveBeenCalled();
		expect(args2.ack).toHaveBeenCalledOnce();
	});

	it("passes through same event_id after TTL expires", async () => {
		const ttl = 60_000;
		const dedup = createDeduplicator(ttl);
		const args1 = makeArgs({ body: { event_id: "evt-ttl" } });
		const args2 = makeArgs({ body: { event_id: "evt-ttl" } });

		await dedup(args1 as never);

		vi.advanceTimersByTime(ttl + 1);

		await dedup(args2 as never);

		expect(args1.next).toHaveBeenCalledOnce();
		expect(args2.next).toHaveBeenCalledOnce();
	});

	it("passes through events without event_id", async () => {
		const dedup = createDeduplicator();
		const args = makeArgs({ body: {} });

		await dedup(args as never);

		expect(args.next).toHaveBeenCalledOnce();
	});

	it("does not call ack when args has no ack on duplicate", async () => {
		const dedup = createDeduplicator();
		const args1 = makeArgs({ body: { event_id: "evt-noack" } });
		const args2 = makeArgs({ body: { event_id: "evt-noack" }, ack: undefined });

		await dedup(args1 as never);
		await dedup(args2 as never);

		expect(args2.next).not.toHaveBeenCalled();
	});
});

describe("createBotFilter", () => {
	it("filters out messages with bot_id", async () => {
		const filter = createBotFilter();
		const args = makeArgs({ payload: { bot_id: "B12345" } });

		await filter(args as never);

		expect(args.next).not.toHaveBeenCalled();
		expect(args.ack).toHaveBeenCalledOnce();
	});

	it("filters out messages with subtype bot_message", async () => {
		const filter = createBotFilter();
		const args = makeArgs({ payload: { subtype: "bot_message" } });

		await filter(args as never);

		expect(args.next).not.toHaveBeenCalled();
		expect(args.ack).toHaveBeenCalledOnce();
	});

	it("passes through normal user messages", async () => {
		const filter = createBotFilter();
		const args = makeArgs({ payload: { user: "U12345", text: "hello" } });

		await filter(args as never);

		expect(args.next).toHaveBeenCalledOnce();
		expect(args.ack).not.toHaveBeenCalled();
	});

	it("passes through messages with no payload", async () => {
		const filter = createBotFilter();
		const args = makeArgs({ payload: undefined });

		await filter(args as never);

		expect(args.next).toHaveBeenCalledOnce();
	});

	it("does not call ack when args has no ack on bot message", async () => {
		const filter = createBotFilter();
		const args = makeArgs({ payload: { bot_id: "B99" }, ack: undefined });

		await filter(args as never);

		expect(args.next).not.toHaveBeenCalled();
	});
});
