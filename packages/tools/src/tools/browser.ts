import { mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { LLMToolDefinition } from "@openviktor/shared";
import type { ToolExecutor } from "../registry.js";
import { resolveSafePath, resolveSafePathStrict } from "../workspace.js";

const BROWSERBASE_API_BASE = "https://www.browserbase.com/v1";

type BrowserSessionResponse = {
	session_id: string;
	connect_url: string;
	live_view_url: string;
	recording_url?: string;
};

type BrowserDownloadResult = {
	files_downloaded: number;
	paths: string[];
};

type BrowserCloseResult = {
	ok: true;
};

type CreateSessionOptions = {
	startingUrl: string;
	viewportWidth: number;
	viewportHeight: number;
	enableProxies: boolean;
	timeoutSeconds: number;
};

const notConfiguredExecutor: ToolExecutor = async () => ({
	output: null,
	durationMs: 0,
	error: "BROWSERBASE_API_KEY not configured",
});

function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function getUrlFromEntry(record: Record<string, unknown>): string | null {
	for (const key of ["url", "downloadUrl", "download_url", "signedUrl", "signed_url"]) {
		if (typeof record[key] === "string" && (record[key] as string).length > 0) {
			return record[key] as string;
		}
	}
	return null;
}

function getFilenameFromEntry(record: Record<string, unknown>, url: string): string {
	for (const key of ["filename", "name"]) {
		if (typeof record[key] === "string" && (record[key] as string).length > 0) {
			return record[key] as string;
		}
	}
	try {
		return basename(new URL(url).pathname) || "download.bin";
	} catch {
		return "download.bin";
	}
}

function getDownloadEntries(payload: unknown): Array<{ filename: string; url: string }> {
	if (!payload || typeof payload !== "object") {
		return [];
	}

	const obj = payload as Record<string, unknown>;
	const entries = Array.isArray(obj.downloads)
		? obj.downloads
		: Array.isArray(obj.files)
			? obj.files
			: Array.isArray(payload)
				? (payload as unknown[])
				: [];

	const result: Array<{ filename: string; url: string }> = [];
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const record = entry as Record<string, unknown>;
		const url = getUrlFromEntry(record);
		if (!url) {
			continue;
		}
		result.push({ filename: getFilenameFromEntry(record, url), url });
	}
	return result;
}

function parseSessionPayload(payload: Record<string, unknown>): BrowserSessionResponse {
	return {
		session_id:
			asString(payload.id) ?? asString(payload.session_id) ?? asString(payload.sessionId) ?? "",
		connect_url:
			asString(payload.connect_url) ??
			asString(payload.connectUrl) ??
			asString(payload.wsUrl) ??
			"",
		live_view_url:
			asString(payload.live_view_url) ??
			asString(payload.liveViewUrl) ??
			asString(payload.live_url) ??
			"",
		recording_url: asString(payload.recording_url) ?? asString(payload.recordingUrl) ?? undefined,
	};
}

function parseCreateSessionOptions(args: Record<string, unknown>): CreateSessionOptions | null {
	if (typeof args.starting_url !== "string") {
		return null;
	}

	return {
		startingUrl: args.starting_url,
		viewportWidth: typeof args.viewport_width === "number" ? args.viewport_width : 1024,
		viewportHeight: typeof args.viewport_height === "number" ? args.viewport_height : 768,
		enableProxies: typeof args.enable_proxies === "boolean" ? args.enable_proxies : false,
		timeoutSeconds: typeof args.timeout_seconds === "number" ? args.timeout_seconds : 300,
	};
}

async function requestSession(
	options: CreateSessionOptions,
	apiKey: string,
): Promise<BrowserSessionResponse> {
	void options.startingUrl;
	const response = await fetch(`${BROWSERBASE_API_BASE}/sessions`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-bb-api-key": apiKey,
		},
		body: JSON.stringify({
			projectId: undefined,
			browserSettings: {
				viewport: {
					width: options.viewportWidth,
					height: options.viewportHeight,
				},
			},
			proxies: options.enableProxies,
			timeout: options.timeoutSeconds,
		}),
	});

	if (!response.ok) {
		throw new Error(`Browserbase create session failed: ${response.status} ${response.statusText}`);
	}

	const payload = (await response.json()) as Record<string, unknown>;
	return parseSessionPayload(payload);
}

async function listDownloads(
	sessionId: string,
	apiKey: string,
): Promise<Array<{ filename: string; url: string }>> {
	const response = await fetch(
		`${BROWSERBASE_API_BASE}/sessions/${encodeURIComponent(sessionId)}/downloads`,
		{
			method: "GET",
			headers: {
				"x-bb-api-key": apiKey,
			},
		},
	);

	if (!response.ok) {
		throw new Error(`Browserbase list downloads failed: ${response.status} ${response.statusText}`);
	}

	const payload = await response.json();
	return getDownloadEntries(payload);
}

async function downloadOneFile(
	url: string,
	filename: string,
	destDir: string,
	apiKey: string,
): Promise<string | null> {
	const resp = await fetch(url, { method: "GET", headers: { "x-bb-api-key": apiKey } });
	if (!resp.ok) {
		return null;
	}
	const bytes = Buffer.from(await resp.arrayBuffer());
	const outPath = resolveSafePath(destDir, filename);
	await writeFile(outPath, bytes);
	return outPath;
}

async function downloadAllFiles(
	downloads: Array<{ filename: string; url: string }>,
	destinationDir: string,
	apiKey: string,
): Promise<string[]> {
	const paths: string[] = [];
	for (const download of downloads) {
		const outPath = await downloadOneFile(download.url, download.filename, destinationDir, apiKey);
		if (outPath) {
			paths.push(outPath);
		}
	}
	return paths;
}

export const browserCreateSessionDefinition: LLMToolDefinition = {
	name: "browser_create_session",
	description: "Create a Browserbase browser session.",
	input_schema: {
		type: "object",
		properties: {
			starting_url: { type: "string", description: "Initial URL for browser session" },
			viewport_width: { type: "number", description: "Viewport width in pixels (default 1024)" },
			viewport_height: { type: "number", description: "Viewport height in pixels (default 768)" },
			enable_proxies: { type: "boolean", description: "Enable Browserbase proxies" },
			timeout_seconds: { type: "number", description: "Session timeout in seconds" },
		},
		required: ["starting_url"],
	},
};

export const browserDownloadFilesDefinition: LLMToolDefinition = {
	name: "browser_download_files",
	description: "Download files produced in a Browserbase session.",
	input_schema: {
		type: "object",
		properties: {
			session_id: { type: "string", description: "Browserbase session ID" },
			target_directory: {
				type: "string",
				description: "Target directory relative to workspace (default downloads)",
			},
		},
		required: ["session_id"],
	},
};

export const browserCloseSessionDefinition: LLMToolDefinition = {
	name: "browser_close_session",
	description: "Close a Browserbase session.",
	input_schema: {
		type: "object",
		properties: {
			session_id: { type: "string", description: "Browserbase session ID" },
		},
		required: ["session_id"],
	},
};

export function createBrowserExecutors(browserbaseApiKey: string): {
	browser_create_session: ToolExecutor;
	browser_download_files: ToolExecutor;
	browser_close_session: ToolExecutor;
} {
	const browser_create_session: ToolExecutor = async (args) => {
		const options = parseCreateSessionOptions(args);
		if (!options) {
			return { output: null, durationMs: 0, error: "starting_url is required" };
		}

		try {
			const session = await requestSession(options, browserbaseApiKey);
			return { output: session, durationMs: 0 };
		} catch (err) {
			return {
				output: null,
				durationMs: 0,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	};

	const browser_download_files: ToolExecutor = async (args, ctx) => {
		if (typeof args.session_id !== "string") {
			return { output: null, durationMs: 0, error: "session_id is required" };
		}

		const targetDirectory =
			typeof args.target_directory === "string" ? args.target_directory : "downloads";

		try {
			const downloads = await listDownloads(args.session_id, browserbaseApiKey);
			const destinationDir = resolveSafePath(ctx.workspaceDir, targetDirectory);
			await resolveSafePathStrict(ctx.workspaceDir, targetDirectory);
			await mkdir(destinationDir, { recursive: true });

			const paths = await downloadAllFiles(downloads, destinationDir, browserbaseApiKey);
			const output: BrowserDownloadResult = {
				files_downloaded: paths.length,
				paths,
			};
			return { output, durationMs: 0 };
		} catch (err) {
			return {
				output: null,
				durationMs: 0,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	};

	const browser_close_session: ToolExecutor = async (args) => {
		if (typeof args.session_id !== "string") {
			return { output: null, durationMs: 0, error: "session_id is required" };
		}

		try {
			const response = await fetch(
				`${BROWSERBASE_API_BASE}/sessions/${encodeURIComponent(args.session_id)}`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-bb-api-key": browserbaseApiKey,
					},
					body: JSON.stringify({ status: "REQUEST_RELEASE" }),
				},
			);

			if (!response.ok) {
				return {
					output: null,
					durationMs: 0,
					error: `Browserbase close session failed: ${response.status} ${response.statusText}`,
				};
			}

			const output: BrowserCloseResult = { ok: true };
			return { output, durationMs: 0 };
		} catch (err) {
			return {
				output: null,
				durationMs: 0,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	};

	return {
		browser_create_session,
		browser_download_files,
		browser_close_session,
	};
}

export const browserCreateSessionExecutor = notConfiguredExecutor;
export const browserDownloadFilesExecutor = notConfiguredExecutor;
export const browserCloseSessionExecutor = notConfiguredExecutor;
