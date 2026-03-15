import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ConnectionManager,
	EventsApiConnection,
	type EventHandler,
	type InteractionHandler,
} from "../slack/connection-manager.js";

const mockLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	fatal: vi.fn(),
	trace: vi.fn(),
	child: vi.fn().mockReturnThis(),
	level: "info" as const,
	silent: vi.fn(),
	isLevelEnabled: vi.fn(),
} as never;

const mockPrisma = {
	workspace: {
		findMany: vi.fn().mockResolvedValue([]),
		findUnique: vi.fn(),
	},
} as never;

const baseManagedConfig = {
	DEPLOYMENT_MODE: "managed" as const,
	SLACK_SIGNING_SECRET: "test-secret",
	SLACK_CLIENT_ID: "client-id",
	SLACK_CLIENT_SECRET: "client-secret",
	SLACK_STATE_SECRET: "state-secret",
	BASE_URL: "https://app.example.com",
	ENCRYPTION_KEY: "a".repeat(64),
	ANTHROPIC_API_KEY: "sk-ant-test",
	DATABASE_URL: "postgresql://localhost/test",
	NODE_ENV: "test" as const,
} as never;

describe("ConnectionManager", () => {
	let onEvent: EventHandler;
	let onInteraction: InteractionHandler;

	beforeEach(() => {
		vi.clearAllMocks();
		onEvent = vi.fn();
		onInteraction = vi.fn();
	});

	it("starts with zero connections", () => {
		const manager = new ConnectionManager({
			config: baseManagedConfig,
			prisma: mockPrisma,
			logger: mockLogger,
			onEvent,
			onInteraction,
		});
		expect(manager.connectedCount).toBe(0);
		expect(manager.getAll()).toHaveLength(0);
	});

	it("connects an EventsApiConnection in managed mode", async () => {
		const manager = new ConnectionManager({
			config: baseManagedConfig,
			prisma: mockPrisma,
			logger: mockLogger,
			onEvent,
			onInteraction,
		});

		const workspace = {
			id: "ws-1",
			slackTeamId: "T123",
			slackBotToken: "xoxb-test",
			slackBotUserId: "U123",
		};

		const conn = await manager.connect(workspace);
		expect(conn).toBeInstanceOf(EventsApiConnection);
		expect(conn.isConnected()).toBe(true);
		expect(conn.workspaceId).toBe("ws-1");
		expect(conn.teamId).toBe("T123");
		expect(manager.connectedCount).toBe(1);
	});

	it("looks up connection by team ID", async () => {
		const manager = new ConnectionManager({
			config: baseManagedConfig,
			prisma: mockPrisma,
			logger: mockLogger,
			onEvent,
			onInteraction,
		});

		await manager.connect({
			id: "ws-1",
			slackTeamId: "T123",
			slackBotToken: "xoxb-test",
			slackBotUserId: "U123",
		});

		const conn = manager.getConnectionByTeamId("T123");
		expect(conn).toBeDefined();
		expect(conn?.workspaceId).toBe("ws-1");

		expect(manager.getConnectionByTeamId("T999")).toBeUndefined();
	});

	it("disconnects a workspace", async () => {
		const manager = new ConnectionManager({
			config: baseManagedConfig,
			prisma: mockPrisma,
			logger: mockLogger,
			onEvent,
			onInteraction,
		});

		await manager.connect({
			id: "ws-1",
			slackTeamId: "T123",
			slackBotToken: "xoxb-test",
			slackBotUserId: "U123",
		});

		expect(manager.connectedCount).toBe(1);
		await manager.disconnect("ws-1");
		expect(manager.connectedCount).toBe(0);
		expect(manager.getConnection("ws-1")).toBeUndefined();
	});

	it("disconnects all workspaces", async () => {
		const manager = new ConnectionManager({
			config: baseManagedConfig,
			prisma: mockPrisma,
			logger: mockLogger,
			onEvent,
			onInteraction,
		});

		await manager.connect({
			id: "ws-1",
			slackTeamId: "T1",
			slackBotToken: "xoxb-1",
			slackBotUserId: "U1",
		});
		await manager.connect({
			id: "ws-2",
			slackTeamId: "T2",
			slackBotToken: "xoxb-2",
			slackBotUserId: "U2",
		});

		expect(manager.connectedCount).toBe(2);
		await manager.disconnectAll();
		expect(manager.connectedCount).toBe(0);
	});

	it("replaces existing connection on re-connect", async () => {
		const manager = new ConnectionManager({
			config: baseManagedConfig,
			prisma: mockPrisma,
			logger: mockLogger,
			onEvent,
			onInteraction,
		});

		const ws = {
			id: "ws-1",
			slackTeamId: "T123",
			slackBotToken: "xoxb-old",
			slackBotUserId: "U123",
		};

		await manager.connect(ws);
		const conn1 = manager.getConnection("ws-1");

		await manager.connect({ ...ws, slackBotToken: "xoxb-new" });
		const conn2 = manager.getConnection("ws-1");

		expect(conn1).not.toBe(conn2);
		expect(manager.connectedCount).toBe(1);
	});
});

describe("EventsApiConnection", () => {
	it("provides WebClient via getClient()", () => {
		const conn = new EventsApiConnection("ws-1", "T123", "xoxb-test", "U123", mockLogger);
		const client = conn.getClient();
		expect(client).toBeDefined();
		expect(client.token).toBe("xoxb-test");
	});

	it("tracks connected state", async () => {
		const conn = new EventsApiConnection("ws-1", "T123", "xoxb-test", "U123", mockLogger);
		expect(conn.isConnected()).toBe(false);
		await conn.start();
		expect(conn.isConnected()).toBe(true);
		await conn.stop();
		expect(conn.isConnected()).toBe(false);
	});

	it("updates token", () => {
		const conn = new EventsApiConnection("ws-1", "T123", "xoxb-old", "U123", mockLogger);
		expect(conn.getClient().token).toBe("xoxb-old");
		conn.updateToken("xoxb-new");
		expect(conn.getClient().token).toBe("xoxb-new");
	});
});
