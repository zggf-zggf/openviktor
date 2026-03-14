import type {
	PipedreamAccount,
	PipedreamAction,
	PipedreamActionResult,
	PipedreamApp,
	PipedreamConfig,
	PipedreamConfigureOptions,
	PipedreamConnectToken,
	PipedreamListActionsOptions,
	PipedreamListAppsOptions,
	PipedreamProxyOptions,
	PipedreamRunActionOptions,
} from "./types.js";

const BASE_URL = "https://api.pipedream.com/v1";
const CONNECT_BASE_URL = "https://api.pipedream.com/v1/connect";
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 min (tokens valid for 1h)

export class PipedreamClient {
	private config: PipedreamConfig;
	private cachedToken: { token: string; expiresAt: number } | null = null;

	constructor(config: PipedreamConfig) {
		this.config = config;
	}

	private async getAccessToken(): Promise<string> {
		if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
			return this.cachedToken.token;
		}

		const response = await fetch(`${BASE_URL}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "client_credentials",
				client_id: this.config.clientId,
				client_secret: this.config.clientSecret,
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Pipedream OAuth failed (${response.status}): ${text}`);
		}

		const data = (await response.json()) as { access_token: string };
		this.cachedToken = {
			token: data.access_token,
			expiresAt: Date.now() + TOKEN_TTL_MS,
		};
		return data.access_token;
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
		baseUrl = BASE_URL,
	): Promise<T> {
		const token = await this.getAccessToken();
		const url = `${baseUrl}${path}`;

		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"X-PD-Environment": this.config.environment,
		};

		const response = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Pipedream API error (${response.status} ${method} ${path}): ${text}`);
		}

		if (response.status === 204) {
			return undefined as T;
		}

		return (await response.json()) as T;
	}

	async listApps(opts?: PipedreamListAppsOptions): Promise<PipedreamApp[]> {
		const params = new URLSearchParams();
		if (opts?.q) params.set("q", opts.q);
		if (opts?.hasActions) params.set("has_actions", "true");
		if (opts?.limit) params.set("limit", String(opts.limit));
		const qs = params.toString();
		const path = `/connect/apps${qs ? `?${qs}` : ""}`;
		const result = await this.request<{ data: PipedreamApp[] }>("GET", path);
		return result.data;
	}

	async listActions(opts: PipedreamListActionsOptions): Promise<PipedreamAction[]> {
		const params = new URLSearchParams();
		params.set("app", opts.app);
		if (opts.q) params.set("q", opts.q);
		if (opts.limit) params.set("limit", String(opts.limit));
		const path = `/connect/${this.config.projectId}/actions?${params.toString()}`;
		const result = await this.request<{ data: PipedreamAction[] }>("GET", path);
		return result.data;
	}

	async runAction(opts: PipedreamRunActionOptions): Promise<PipedreamActionResult> {
		return this.request<PipedreamActionResult>(
			"POST",
			`/connect/${this.config.projectId}/actions/run`,
			{
				id: opts.actionId,
				external_user_id: opts.externalUserId,
				configured_props: opts.configuredProps,
			},
		);
	}

	async configure(opts: PipedreamConfigureOptions): Promise<unknown> {
		return this.request<unknown>("POST", `/connect/${this.config.projectId}/actions/configure`, {
			id: opts.actionKey,
			prop_name: opts.propName,
			external_user_id: opts.externalUserId,
			configured_props: opts.configuredProps ?? {},
		});
	}

	async createConnectToken(externalUserId: string): Promise<PipedreamConnectToken> {
		return this.request<PipedreamConnectToken>("POST", `/connect/${this.config.projectId}/tokens`, {
			external_user_id: externalUserId,
		});
	}

	async listAccounts(externalUserId: string, app?: string): Promise<PipedreamAccount[]> {
		const params = new URLSearchParams();
		params.set("external_user_id", externalUserId);
		if (app) params.set("app", app);
		const path = `/connect/${this.config.projectId}/accounts?${params.toString()}`;
		const result = await this.request<{ data: PipedreamAccount[] }>("GET", path);
		return result.data;
	}

	async deleteAccount(accountId: string): Promise<void> {
		await this.request<void>("DELETE", `/connect/${this.config.projectId}/accounts/${accountId}`);
	}

	async proxyRequest(opts: PipedreamProxyOptions): Promise<unknown> {
		const token = await this.getAccessToken();
		const encodedUrl = Buffer.from(opts.url).toString("base64url");
		const qs = new URLSearchParams({
			external_user_id: opts.externalUserId,
			account_id: opts.authProvisionId,
		});
		const url = `${BASE_URL}/connect/${this.config.projectId}/proxy/${encodedUrl}?${qs}`;

		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"X-PD-Environment": this.config.environment,
		};

		if (opts.headers) {
			for (const [key, value] of Object.entries(opts.headers)) {
				headers[`x-pd-proxy-${key}`] = value;
			}
		}

		const response = await fetch(url, {
			method: opts.method,
			headers,
			body: opts.body ? JSON.stringify(opts.body) : undefined,
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Pipedream proxy error (${response.status} ${opts.method} ${opts.url}): ${text}`);
		}

		if (response.status === 204) return undefined;
		return response.json();
	}
}
