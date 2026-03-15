import type { PrismaClient } from "@openviktor/db";
import type { EnvConfig, Logger } from "@openviktor/shared";
import { isSelfHosted } from "@openviktor/shared";
import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { createSlackLoggerAdapter } from "./app.js";

export interface SlackConnection {
	workspaceId: string;
	teamId: string;
	botUserId: string;
	start(): Promise<void>;
	stop(): Promise<void>;
	getClient(): WebClient;
	isConnected(): boolean;
}

export interface SlackEvent {
	type: "app_mention" | "message";
	teamId: string;
	channel: string;
	user?: string;
	text?: string;
	ts: string;
	threadTs?: string;
	channelType?: string;
	subtype?: string;
	botId?: string;
}

export interface SlackInteraction {
	type: "block_actions" | "view_submission";
	teamId: string;
	payload: unknown;
}

export type EventHandler = (
	event: SlackEvent,
	connection: SlackConnection,
	say: (opts: { text: string; thread_ts?: string }) => Promise<unknown>,
) => Promise<void>;

export type InteractionHandler = (
	interaction: SlackInteraction,
	connection: SlackConnection,
) => Promise<void>;

export class SocketModeConnection implements SlackConnection {
	workspaceId: string;
	teamId: string;
	botUserId: string;
	private app: App;
	private connected = false;

	constructor(
		workspaceId: string,
		teamId: string,
		botToken: string,
		appToken: string,
		signingSecret: string,
		botUserId: string,
		private onEvent: EventHandler,
		private onInteraction: InteractionHandler,
		private logger: Logger,
	) {
		this.workspaceId = workspaceId;
		this.teamId = teamId;
		this.botUserId = botUserId;

		this.app = new App({
			token: botToken,
			appToken,
			signingSecret,
			socketMode: true,
			logger: createSlackLoggerAdapter(logger),
		});

		this.registerHandlers();
	}

	private registerHandlers(): void {
		this.app.event("app_mention", async ({ event, say, context }) => {
			const slackEvent: SlackEvent = {
				type: "app_mention",
				teamId: context.teamId ?? this.teamId,
				channel: event.channel,
				user: event.user,
				text: event.text,
				ts: event.ts,
				threadTs: event.thread_ts,
			};
			await this.onEvent(slackEvent, this, say);
		});

		this.app.event("message", async ({ event, say, context }) => {
			const msg = event as unknown as Record<string, unknown>;
			const slackEvent: SlackEvent = {
				type: "message",
				teamId: context.teamId ?? this.teamId,
				channel: msg.channel as string,
				user: msg.user as string | undefined,
				text: msg.text as string | undefined,
				ts: msg.ts as string,
				threadTs: msg.thread_ts as string | undefined,
				channelType: msg.channel_type as string | undefined,
				subtype: msg.subtype as string | undefined,
				botId: msg.bot_id as string | undefined,
			};
			await this.onEvent(slackEvent, this, say);
		});

		this.app.action(/.*/, async ({ ack, body }) => {
			await ack();
			const interaction: SlackInteraction = {
				type: "block_actions",
				teamId: ((body as unknown as Record<string, unknown>).team_id as string) ?? this.teamId,
				payload: body,
			};
			await this.onInteraction(interaction, this);
		});
	}

	async start(): Promise<void> {
		await this.app.start();
		this.connected = true;
		this.logger.info(
			{ workspaceId: this.workspaceId, teamId: this.teamId },
			"Socket Mode connection started",
		);
	}

	async stop(): Promise<void> {
		await this.app.stop();
		this.connected = false;
		this.logger.info({ workspaceId: this.workspaceId }, "Socket Mode connection stopped");
	}

	getClient(): WebClient {
		return this.app.client;
	}

	isConnected(): boolean {
		return this.connected;
	}

	getApp(): App {
		return this.app;
	}
}

export class EventsApiConnection implements SlackConnection {
	workspaceId: string;
	teamId: string;
	botUserId: string;
	private client: WebClient;
	private connected = false;

	constructor(
		workspaceId: string,
		teamId: string,
		botToken: string,
		botUserId: string,
		private logger: Logger,
	) {
		this.workspaceId = workspaceId;
		this.teamId = teamId;
		this.botUserId = botUserId;
		this.client = new WebClient(botToken);
	}

	async start(): Promise<void> {
		this.connected = true;
		this.logger.info(
			{ workspaceId: this.workspaceId, teamId: this.teamId },
			"Events API connection registered",
		);
	}

	async stop(): Promise<void> {
		this.connected = false;
		this.logger.info({ workspaceId: this.workspaceId }, "Events API connection unregistered");
	}

	getClient(): WebClient {
		return this.client;
	}

	isConnected(): boolean {
		return this.connected;
	}

	updateToken(botToken: string): void {
		this.client = new WebClient(botToken);
	}
}

export interface ConnectionManagerConfig {
	config: EnvConfig;
	prisma: PrismaClient;
	logger: Logger;
	onEvent: EventHandler;
	onInteraction: InteractionHandler;
}

export class ConnectionManager {
	private connections = new Map<string, SlackConnection>();
	private teamToWorkspace = new Map<string, string>();
	private config: EnvConfig;
	private prisma: PrismaClient;
	private logger: Logger;
	private onEvent: EventHandler;
	private onInteraction: InteractionHandler;

	constructor(deps: ConnectionManagerConfig) {
		this.config = deps.config;
		this.prisma = deps.prisma;
		this.logger = deps.logger;
		this.onEvent = deps.onEvent;
		this.onInteraction = deps.onInteraction;
	}

	async connectAll(): Promise<void> {
		const workspaces = await this.prisma.workspace.findMany({
			where: { isActive: true },
		});

		if (workspaces.length === 0 && isSelfHosted(this.config)) {
			this.logger.info(
				"No workspaces in DB — first workspace will be created on first Slack event",
			);
		}

		for (const ws of workspaces) {
			try {
				await this.connect(ws);
			} catch (err) {
				this.logger.error(
					{ err, workspaceId: ws.id, teamId: ws.slackTeamId },
					"Failed to connect workspace",
				);
			}
		}

		this.logger.info({ count: this.connections.size }, "All workspace connections established");
	}

	async connect(workspace: {
		id: string;
		slackTeamId: string;
		slackBotToken: string;
		slackBotUserId: string;
		slackAppToken?: string | null;
	}): Promise<SlackConnection> {
		if (this.connections.has(workspace.id)) {
			await this.disconnect(workspace.id);
		}

		let connection: SlackConnection;

		if (isSelfHosted(this.config)) {
			const appToken = workspace.slackAppToken ?? this.config.SLACK_APP_TOKEN;
			if (!appToken) {
				throw new Error(
					`No app token available for workspace ${workspace.id}. Set SLACK_APP_TOKEN or store slackAppToken in workspace.`,
				);
			}

			connection = new SocketModeConnection(
				workspace.id,
				workspace.slackTeamId,
				workspace.slackBotToken,
				appToken,
				this.config.SLACK_SIGNING_SECRET,
				workspace.slackBotUserId,
				this.onEvent,
				this.onInteraction,
				this.logger,
			);
		} else {
			connection = new EventsApiConnection(
				workspace.id,
				workspace.slackTeamId,
				workspace.slackBotToken,
				workspace.slackBotUserId,
				this.logger,
			);
		}

		await connection.start();
		this.connections.set(workspace.id, connection);
		this.teamToWorkspace.set(workspace.slackTeamId, workspace.id);

		return connection;
	}

	async disconnect(workspaceId: string): Promise<void> {
		const connection = this.connections.get(workspaceId);
		if (!connection) return;

		await connection.stop();
		this.connections.delete(workspaceId);
		this.teamToWorkspace.delete(connection.teamId);
	}

	async reconnect(workspaceId: string): Promise<void> {
		const workspace = await this.prisma.workspace.findUnique({
			where: { id: workspaceId },
		});
		if (!workspace) {
			throw new Error(`Workspace ${workspaceId} not found`);
		}
		await this.connect(workspace);
	}

	getConnection(workspaceId: string): SlackConnection | undefined {
		return this.connections.get(workspaceId);
	}

	getConnectionByTeamId(teamId: string): SlackConnection | undefined {
		const workspaceId = this.teamToWorkspace.get(teamId);
		if (!workspaceId) return undefined;
		return this.connections.get(workspaceId);
	}

	getAll(): SlackConnection[] {
		return Array.from(this.connections.values());
	}

	getWorkspaceIdByTeamId(teamId: string): string | undefined {
		return this.teamToWorkspace.get(teamId);
	}

	get connectedCount(): number {
		return this.connections.size;
	}

	async disconnectAll(): Promise<void> {
		const promises = Array.from(this.connections.keys()).map((id) => this.disconnect(id));
		await Promise.allSettled(promises);
		this.logger.info("All workspace connections closed");
	}
}
