import { createHmac } from "node:crypto";
import type { PrismaClient } from "@openviktor/db";
import type { EnvConfig, Logger } from "@openviktor/shared";
import { getDashboardAuthMode } from "@openviktor/shared";

export interface AuthContext {
	username: string;
	mode: "basic" | "slack-oauth";
	slackUserId?: string;
	workspaceIds?: string[];
}

export interface AuthMiddlewareConfig {
	config: EnvConfig;
	prisma: PrismaClient;
	logger: Logger;
}

function signJwt(
	payload: Record<string, unknown>,
	secret: string,
	expiresInMs = 86_400_000,
): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const now = Date.now();
	const body = Buffer.from(
		JSON.stringify({ ...payload, iat: now, exp: now + expiresInMs }),
	).toString("base64url");
	const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${signature}`;
}

function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	const [header, body, signature] = parts;
	const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	if (signature !== expected) return null;

	try {
		const payload = JSON.parse(Buffer.from(body, "base64url").toString());
		if (payload.exp && payload.exp < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

function getJwtSecret(config: EnvConfig): string {
	return config.ENCRYPTION_KEY ?? config.SLACK_SIGNING_SECRET;
}

export function createAuthMiddleware(deps: AuthMiddlewareConfig) {
	const { config, prisma, logger } = deps;
	const authMode = getDashboardAuthMode(config);
	const jwtSecret = getJwtSecret(config);

	async function handleLogin(req: Request): Promise<Response> {
		if (authMode !== "basic") {
			return Response.json({ error: "Basic auth not enabled" }, { status: 400 });
		}

		const body = (await req.json()) as { username?: string; password?: string };
		const { username, password } = body;

		if (!username || !password) {
			return Response.json({ error: "Username and password required" }, { status: 400 });
		}

		if (username !== config.DASHBOARD_USERNAME || password !== config.DASHBOARD_PASSWORD) {
			logger.warn({ username }, "Failed login attempt");
			return Response.json({ error: "Invalid credentials" }, { status: 401 });
		}

		const token = signJwt({ sub: username, mode: "basic" }, jwtSecret);

		const headers = new Headers({
			"Content-Type": "application/json",
			"Set-Cookie": `ov_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
		});

		return new Response(JSON.stringify({ success: true }), { headers });
	}

	async function authenticate(req: Request): Promise<AuthContext | null> {
		// Try JWT cookie first
		const cookie = req.headers.get("cookie") ?? "";
		const sessionMatch = cookie.match(/ov_session=([^\s;]+)/);
		if (sessionMatch) {
			const payload = verifyJwt(sessionMatch[1], jwtSecret);
			if (payload) {
				const ctx: AuthContext = {
					username: payload.sub as string,
					mode: payload.mode as "basic" | "slack-oauth",
					slackUserId: payload.slackUserId as string | undefined,
				};

				if (ctx.mode === "slack-oauth" && ctx.slackUserId) {
					const members = await prisma.member.findMany({
						where: { slackUserId: ctx.slackUserId },
						select: { workspaceId: true },
					});
					ctx.workspaceIds = members.map((m) => m.workspaceId);
				}

				return ctx;
			}
		}

		// Try Basic Auth header
		if (authMode === "basic") {
			const authHeader = req.headers.get("authorization") ?? "";
			if (authHeader.startsWith("Basic ")) {
				const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
				const [username, password] = decoded.split(":");
				if (username === config.DASHBOARD_USERNAME && password === config.DASHBOARD_PASSWORD) {
					return { username, mode: "basic" };
				}
			}
		}

		return null;
	}

	function resolveWorkspaceId(req: Request, auth: AuthContext): string | null {
		const headerWsId = req.headers.get("x-workspace-id");

		// In slack-oauth mode, scope to user's workspaces
		if (auth.mode === "slack-oauth" && auth.workspaceIds) {
			if (headerWsId && auth.workspaceIds.includes(headerWsId)) {
				return headerWsId;
			}
			return auth.workspaceIds[0] ?? null;
		}

		// In basic mode, any workspace is accessible
		return headerWsId ?? null;
	}

	return {
		handleLogin,
		authenticate,
		resolveWorkspaceId,
		signJwt: (payload: Record<string, unknown>) => signJwt(payload, jwtSecret),
	};
}
