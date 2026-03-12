import type { AllMiddlewareArgs, AnyMiddlewareArgs } from "@slack/bolt";

export function createDeduplicator(ttlMs = 300_000) {
	const seen = new Map<string, number>();

	const cleanup = () => {
		const now = Date.now();
		for (const [id, ts] of seen) {
			if (now - ts > ttlMs) {
				seen.delete(id);
			}
		}
	};

	return async (args: AnyMiddlewareArgs & AllMiddlewareArgs): Promise<void> => {
		const body = args.body as { event_id?: string };
		const eventId = body.event_id;

		if (eventId) {
			const now = Date.now();
			const seenAt = seen.get(eventId);
			if (seenAt !== undefined && now - seenAt < ttlMs) {
				if ("ack" in args && typeof args.ack === "function") {
					await args.ack();
				}
				return;
			}
			seen.set(eventId, now);
			cleanup();
		}

		await args.next();
	};
}

export function createBotFilter() {
	return async (args: AnyMiddlewareArgs & AllMiddlewareArgs): Promise<void> => {
		const payload = args.payload as { bot_id?: string; subtype?: string } | undefined;
		if (payload && (payload.bot_id || payload.subtype === "bot_message")) {
			if ("ack" in args && typeof args.ack === "function") {
				await args.ack();
			}
			return;
		}
		await args.next();
	};
}
