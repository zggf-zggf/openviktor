import type { Logger } from "@openviktor/shared";
import type { App } from "@slack/bolt";

export function registerEventHandlers(app: App, logger: Logger): void {
	app.event("app_mention", async ({ event }) => {
		logger.info({
			event: "app_mention",
			channel: event.channel,
			user: event.user,
			text: event.text,
			ts: event.ts,
			eventId: event.event_ts,
		});
	});

	app.event("message", async ({ event }) => {
		const msg = event as typeof event & { channel_type?: string; user?: string; text?: string };
		if (msg.channel_type !== "im") return;

		logger.info({
			event: "message_im",
			channel: msg.channel,
			user: msg.user,
			text: msg.text,
			ts: msg.ts,
			eventId: msg.event_ts,
		});
	});
}
