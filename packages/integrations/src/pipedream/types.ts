export interface PipedreamConfig {
	clientId: string;
	clientSecret: string;
	projectId: string;
	environment: "development" | "production";
}

export interface PipedreamApp {
	name_slug: string;
	name: string;
	description?: string;
	auth_type?: string;
	img_src?: string;
	categories?: string[];
}

export interface PipedreamConfigurableProp {
	name: string;
	type: string;
	label?: string;
	description?: string;
	optional?: boolean;
	default?: unknown;
	options?: unknown[];
	app?: string;
}

export interface PipedreamAction {
	id: string;
	key: string;
	name: string;
	description?: string;
	version: string;
	configurable_props: PipedreamConfigurableProp[];
}

export interface PipedreamActionResult {
	exports?: Record<string, unknown>;
	/** The action's return value (Pipedream API field name is `ret`) */
	ret?: unknown;
	error?: string;
}

export interface PipedreamAccount {
	id: string;
	name?: string;
	app?: { name_slug: string; name: string };
	external_id?: string;
	healthy?: boolean;
	dead?: boolean;
	created_at?: string;
	updated_at?: string;
}

export interface PipedreamConnectToken {
	token: string;
	expires_at: string;
	connect_link_url: string;
}

export interface PipedreamListAppsOptions {
	q?: string;
	hasActions?: boolean;
	limit?: number;
}

export interface PipedreamListActionsOptions {
	app: string;
	q?: string;
	limit?: number;
}

export interface PipedreamRunActionOptions {
	actionId: string;
	externalUserId: string;
	configuredProps: Record<string, unknown>;
}

export interface PipedreamConfigureOptions {
	actionKey: string;
	propName: string;
	externalUserId: string;
	configuredProps?: Record<string, unknown>;
}

export interface PipedreamProxyOptions {
	app: string;
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	url: string;
	externalUserId: string;
	authProvisionId: string;
	body?: unknown;
	headers?: Record<string, string>;
}
