import { createHmac, timingSafeEqual } from "node:crypto";
import type { Logger } from "@openviktor/shared";
import type { WebClient } from "@slack/web-api";
import type { ConnectionManager, EventHandler, SlackEvent } from "./connection-manager.js";

export interface EventsApiConfig {
	signingSecret: string;
	connectionManager: ConnectionManager;
	onEvent: EventHandler;
	logger: Logger;
}

function verifySlackSignature(
	signingSecret: string,
	timestamp: string,
	body: string,
	signature: string,
): boolean {
	const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
	if (Number.parseInt(timestamp, 10) < fiveMinutesAgo) {
		return false;
	}

	const sigBasestring = `v0:${timestamp}:${body}`;
	const hmac = createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");
	const computed = `v0=${hmac}`;

	if (computed.length !== signature.length) return false;
	return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

export function createEventsApiHandler(config: EventsApiConfig) {
	const { signingSecret, connectionManager, onEvent, logger } = config;

	async function handleEventsRequest(req: Request): Promise<Response> {
		const body = await req.text();
		const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
		const signature = req.headers.get("x-slack-signature") ?? "";

		if (!verifySlackSignature(signingSecret, timestamp, body, signature)) {
			logger.warn("Invalid Slack signature on events request");
			return new Response("Invalid signature", { status: 401 });
		}

		const payload = JSON.parse(body);

		// URL verification challenge
		if (payload.type === "url_verification") {
			return Response.json({ challenge: payload.challenge });
		}

		if (payload.type !== "event_callback") {
			return new Response("OK", { status: 200 });
		}

		const event = payload.event;
		const teamId = payload.team_id as string;

		const connection = connectionManager.getConnectionByTeamId(teamId);
		if (!connection) {
			logger.warn({ teamId }, "Received event for unknown team");
			return new Response("OK", { status: 200 });
		}

		// Respond immediately, process async
		const slackEvent = mapSlackEvent(event, teamId);
		if (slackEvent) {
			const say = createSayFunction(connection.getClient(), slackEvent.channel);
			void onEvent(slackEvent, connection, say).catch((err) => {
				logger.error({ err, teamId, eventType: event.type }, "Error processing event");
			});
		}

		return new Response("OK", { status: 200 });
	}

	async function handleInteractionsRequest(req: Request): Promise<Response> {
		const body = await req.text();
		const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
		const signature = req.headers.get("x-slack-signature") ?? "";

		if (!verifySlackSignature(signingSecret, timestamp, body, signature)) {
			logger.warn("Invalid Slack signature on interactions request");
			return new Response("Invalid signature", { status: 401 });
		}

		const params = new URLSearchParams(body);
		const payloadStr = params.get("payload");
		if (!payloadStr) {
			return new Response("Missing payload", { status: 400 });
		}

		const payload = JSON.parse(payloadStr);
		const teamId = payload.team?.id ?? payload.user?.team_id;

		if (!teamId) {
			logger.warn("No team_id in interaction payload");
			return new Response("OK", { status: 200 });
		}

		const connection = connectionManager.getConnectionByTeamId(teamId);
		if (!connection) {
			logger.warn({ teamId }, "Received interaction for unknown team");
			return new Response("OK", { status: 200 });
		}

		// Acknowledge immediately — interactions have a 3s deadline
		return new Response("OK", { status: 200 });
	}

	return {
		handleEventsRequest,
		handleInteractionsRequest,
	};
}

function mapSlackEvent(event: Record<string, unknown>, teamId: string): SlackEvent | null {
	const eventType = event.type as string;

	if (eventType === "app_mention") {
		return {
			type: "app_mention",
			teamId,
			channel: event.channel as string,
			user: event.user as string | undefined,
			text: event.text as string | undefined,
			ts: event.ts as string,
			threadTs: event.thread_ts as string | undefined,
		};
	}

	if (eventType === "message") {
		return {
			type: "message",
			teamId,
			channel: event.channel as string,
			user: event.user as string | undefined,
			text: event.text as string | undefined,
			ts: event.ts as string,
			threadTs: event.thread_ts as string | undefined,
			channelType: event.channel_type as string | undefined,
			subtype: event.subtype as string | undefined,
			botId: event.bot_id as string | undefined,
		};
	}

	return null;
}

function createSayFunction(client: WebClient, channel: string) {
	return async (opts: { text: string; thread_ts?: string }) => {
		return client.chat.postMessage({
			channel,
			text: opts.text,
			thread_ts: opts.thread_ts,
		});
	};
}
