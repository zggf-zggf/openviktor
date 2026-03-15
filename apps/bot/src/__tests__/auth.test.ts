import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthMiddleware } from "../middleware/auth.js";

const mockPrisma = {
	member: {
		findMany: vi.fn().mockResolvedValue([]),
	},
} as never;

const mockLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
} as never;

const baseConfig = {
	DEPLOYMENT_MODE: "selfhosted" as const,
	SLACK_SIGNING_SECRET: "test-signing-secret",
	DASHBOARD_AUTH_MODE: "basic" as const,
	DASHBOARD_USERNAME: "admin",
	DASHBOARD_PASSWORD: "test-password",
} as never;

describe("Auth Middleware", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("handleLogin", () => {
		it("returns JWT on valid credentials", async () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			const req = new Request("http://localhost/api/auth/login", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ username: "admin", password: "test-password" }),
			});

			const res = await auth.handleLogin(req);
			const json = (await res.json()) as { success: boolean };
			expect(json.success).toBe(true);

			const cookie = res.headers.get("set-cookie");
			expect(cookie).toContain("ov_session=");
			expect(cookie).toContain("HttpOnly");
		});

		it("rejects invalid credentials", async () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			const req = new Request("http://localhost/api/auth/login", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ username: "admin", password: "wrong" }),
			});

			const res = await auth.handleLogin(req);
			expect(res.status).toBe(401);
		});

		it("rejects missing fields", async () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			const req = new Request("http://localhost/api/auth/login", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			});

			const res = await auth.handleLogin(req);
			expect(res.status).toBe(400);
		});
	});

	describe("authenticate", () => {
		it("authenticates via Basic Auth header", async () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			const credentials = Buffer.from("admin:test-password").toString("base64");
			const req = new Request("http://localhost/api/workspace", {
				headers: { authorization: `Basic ${credentials}` },
			});

			const ctx = await auth.authenticate(req);
			expect(ctx).not.toBeNull();
			expect(ctx?.username).toBe("admin");
			expect(ctx?.mode).toBe("basic");
		});

		it("returns null for invalid Basic Auth", async () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			const credentials = Buffer.from("admin:wrongpass").toString("base64");
			const req = new Request("http://localhost/api/workspace", {
				headers: { authorization: `Basic ${credentials}` },
			});

			const ctx = await auth.authenticate(req);
			expect(ctx).toBeNull();
		});

		it("authenticates via JWT cookie", async () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			// First login to get a token
			const loginReq = new Request("http://localhost/api/auth/login", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ username: "admin", password: "test-password" }),
			});
			const loginRes = await auth.handleLogin(loginReq);
			const cookie = loginRes.headers.get("set-cookie") ?? "";
			const tokenMatch = cookie.match(/ov_session=([^\s;]+)/);

			const req = new Request("http://localhost/api/workspace", {
				headers: { cookie: `ov_session=${tokenMatch?.[1]}` },
			});

			const ctx = await auth.authenticate(req);
			expect(ctx).not.toBeNull();
			expect(ctx?.username).toBe("admin");
		});

		it("returns null for no auth", async () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			const req = new Request("http://localhost/api/workspace");
			const ctx = await auth.authenticate(req);
			expect(ctx).toBeNull();
		});
	});

	describe("resolveWorkspaceId", () => {
		it("returns X-Workspace-Id header value in basic mode", () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			const req = new Request("http://localhost/api/workspace", {
				headers: { "x-workspace-id": "ws-123" },
			});

			const wsId = auth.resolveWorkspaceId(req, { username: "admin", mode: "basic" });
			expect(wsId).toBe("ws-123");
		});

		it("returns null when no header in basic mode", () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			const req = new Request("http://localhost/api/workspace");
			const wsId = auth.resolveWorkspaceId(req, { username: "admin", mode: "basic" });
			expect(wsId).toBeNull();
		});

		it("scopes to user workspaces in slack-oauth mode", () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			const req = new Request("http://localhost/api/workspace", {
				headers: { "x-workspace-id": "ws-456" },
			});

			const wsId = auth.resolveWorkspaceId(req, {
				username: "user",
				mode: "slack-oauth",
				workspaceIds: ["ws-123", "ws-456"],
			});
			expect(wsId).toBe("ws-456");
		});

		it("rejects workspace not in user list for slack-oauth", () => {
			const auth = createAuthMiddleware({
				config: baseConfig,
				prisma: mockPrisma,
				logger: mockLogger,
			});

			const req = new Request("http://localhost/api/workspace", {
				headers: { "x-workspace-id": "ws-999" },
			});

			const wsId = auth.resolveWorkspaceId(req, {
				username: "user",
				mode: "slack-oauth",
				workspaceIds: ["ws-123"],
			});
			expect(wsId).toBe("ws-123"); // Falls back to first allowed
		});
	});
});
