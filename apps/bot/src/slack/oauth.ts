import { createHmac } from "node:crypto";
import type { PrismaClient } from "@openviktor/db";
import type { EnvConfig, Logger } from "@openviktor/shared";
import { encrypt } from "@openviktor/shared";
import { WebClient } from "@slack/web-api";
import type { ConnectionManager } from "./connection-manager.js";

const OAUTH_SCOPES = [
	"app_mentions:read",
	"channels:history",
	"channels:read",
	"chat:write",
	"files:read",
	"files:write",
	"groups:history",
	"groups:read",
	"im:history",
	"im:read",
	"im:write",
	"reactions:read",
	"reactions:write",
	"users:read",
	"team:read",
].join(",");

export interface OAuthHandlerConfig {
	config: EnvConfig;
	prisma: PrismaClient;
	connectionManager: ConnectionManager;
	logger: Logger;
}

function generateState(secret: string): string {
	const timestamp = Date.now().toString();
	const hmac = createHmac("sha256", secret).update(timestamp).digest("hex");
	return `${timestamp}.${hmac}`;
}

function verifyState(state: string, secret: string): boolean {
	const parts = state.split(".");
	if (parts.length !== 2) return false;
	const [timestamp, hmac] = parts;

	// Reject states older than 10 minutes
	const age = Date.now() - Number.parseInt(timestamp, 10);
	if (age > 600_000 || age < 0) return false;

	const expected = createHmac("sha256", secret).update(timestamp).digest("hex");
	return hmac === expected;
}

export function createOAuthHandler(deps: OAuthHandlerConfig) {
	const { config, prisma, connectionManager, logger } = deps;

	if (
		!config.SLACK_CLIENT_ID ||
		!config.SLACK_CLIENT_SECRET ||
		!config.SLACK_STATE_SECRET ||
		!config.BASE_URL ||
		!config.ENCRYPTION_KEY
	) {
		throw new Error(
			"OAuth handler requires SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_STATE_SECRET, BASE_URL, and ENCRYPTION_KEY",
		);
	}

	const clientId: string = config.SLACK_CLIENT_ID;
	const clientSecret: string = config.SLACK_CLIENT_SECRET;
	const stateSecret: string = config.SLACK_STATE_SECRET;
	const baseUrl: string = config.BASE_URL;
	const encryptionKey: string = config.ENCRYPTION_KEY;

	const redirectUri = `${baseUrl}/slack/oauth/callback`;

	async function handleInstall(_req: Request): Promise<Response> {
		const state = generateState(stateSecret);
		const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
		authorizeUrl.searchParams.set("client_id", clientId);
		authorizeUrl.searchParams.set("scope", OAUTH_SCOPES);
		authorizeUrl.searchParams.set("redirect_uri", redirectUri);
		authorizeUrl.searchParams.set("state", state);

		return Response.redirect(authorizeUrl.toString(), 302);
	}

	async function handleCallback(req: Request): Promise<Response> {
		const url = new URL(req.url, baseUrl);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		const error = url.searchParams.get("error");

		if (error) {
			logger.warn({ error }, "OAuth install denied by user");
			return new Response(`Installation cancelled: ${error}`, { status: 400 });
		}

		if (!code || !state) {
			return new Response("Missing code or state parameter", { status: 400 });
		}

		if (!verifyState(state, stateSecret)) {
			return new Response("Invalid or expired state parameter", { status: 400 });
		}

		try {
			const slackClient = new WebClient();
			const oauthResponse = await slackClient.oauth.v2.access({
				client_id: clientId,
				client_secret: clientSecret,
				code,
				redirect_uri: redirectUri,
			});

			if (!oauthResponse.ok || !oauthResponse.access_token || !oauthResponse.team) {
				logger.error({ response: oauthResponse }, "OAuth token exchange failed");
				return new Response("OAuth token exchange failed", { status: 500 });
			}

			const teamId = oauthResponse.team.id as string;
			const teamName = (oauthResponse.team.name as string) ?? "Unknown";
			const botUserId = oauthResponse.bot_user_id as string;
			const accessToken = oauthResponse.access_token as string;
			const refreshToken = (oauthResponse as unknown as Record<string, unknown>).refresh_token as
				| string
				| undefined;
			const installerUserId = (oauthResponse.authed_user as Record<string, unknown>)?.id as
				| string
				| undefined;

			const encryptedAccessToken = encrypt(accessToken, encryptionKey);
			const encryptedRefreshToken = refreshToken ? encrypt(refreshToken, encryptionKey) : null;

			const workspace = await prisma.workspace.upsert({
				where: { slackTeamId: teamId },
				update: {
					slackTeamName: teamName,
					slackBotToken: accessToken,
					slackBotUserId: botUserId,
					oauthAccessToken: encryptedAccessToken,
					oauthRefreshToken: encryptedRefreshToken,
					installedBy: installerUserId,
					isActive: true,
				},
				create: {
					slackTeamId: teamId,
					slackTeamName: teamName,
					slackBotToken: accessToken,
					slackBotUserId: botUserId,
					oauthAccessToken: encryptedAccessToken,
					oauthRefreshToken: encryptedRefreshToken,
					installedBy: installerUserId,
					isActive: true,
				},
			});

			// Register connection
			await connectionManager.connect(workspace);

			// Create installer as first member
			if (installerUserId) {
				const memberClient = new WebClient(accessToken);
				const userInfo = await memberClient.users.info({ user: installerUserId });
				const displayName = userInfo.user?.real_name ?? userInfo.user?.name ?? null;

				await prisma.member.upsert({
					where: {
						workspaceId_slackUserId: {
							workspaceId: workspace.id,
							slackUserId: installerUserId,
						},
					},
					update: { displayName },
					create: {
						workspaceId: workspace.id,
						slackUserId: installerUserId,
						displayName,
					},
				});
			}

			logger.info({ teamId, teamName, workspaceId: workspace.id }, "Workspace installed via OAuth");

			// Redirect to dashboard
			const dashboardUrl = baseUrl.replace(/\/$/, "");
			return Response.redirect(`${dashboardUrl}/`, 302);
		} catch (err) {
			logger.error({ err }, "OAuth callback failed");
			return new Response("Installation failed. Please try again.", { status: 500 });
		}
	}

	return {
		handleInstall,
		handleCallback,
	};
}
