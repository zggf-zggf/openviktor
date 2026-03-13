import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolExecutionContext } from "../registry.js";
import {
	browserCloseSessionExecutor,
	browserCreateSessionExecutor,
	browserDownloadFilesExecutor,
} from "../tools/browser.js";
import { createDocsExecutors } from "../tools/docs.js";
import {
	createCoworkerJoinSlackChannelsExecutor,
	createCoworkerListSlackChannelsExecutor,
	createCoworkerReportIssueExecutor,
} from "../tools/slack-admin.js";

let workspaceDir: string;
let ctx: ToolExecutionContext;

beforeEach(async () => {
	workspaceDir = join(tmpdir(), `tool-test-${Date.now()}`);
	await mkdir(workspaceDir, { recursive: true });
	ctx = { workspaceId: "ws_test", workspaceDir, timeoutMs: 30_000 };
});

afterEach(async () => {
	await rm(workspaceDir, { recursive: true, force: true });
});

describe("resolve_library_id", () => {
	it("returns error when library_name missing", async () => {
		const exec = createDocsExecutors().resolve_library_id;
		const result = await exec({}, ctx);
		expect(result.error).toBe("library_name is required");
	});
});

describe("query_library_docs", () => {
	it("returns error when library_id missing", async () => {
		const exec = createDocsExecutors().query_library_docs;
		const result = await exec({}, ctx);
		expect(result.error).toBe("library_id is required");
	});
});

describe("browser tools (not configured)", () => {
	it("browser_create_session returns not-configured error", async () => {
		const result = await browserCreateSessionExecutor({ starting_url: "https://example.com" }, ctx);
		expect(result.error).toContain("BROWSERBASE_API_KEY");
	});

	it("browser_download_files returns not-configured error", async () => {
		const result = await browserDownloadFilesExecutor({ session_id: "sess_123" }, ctx);
		expect(result.error).toContain("BROWSERBASE_API_KEY");
	});

	it("browser_close_session returns not-configured error", async () => {
		const result = await browserCloseSessionExecutor({ session_id: "sess_123" }, ctx);
		expect(result.error).toContain("BROWSERBASE_API_KEY");
	});
});

describe("coworker_list_slack_channels", () => {
	it("returns error when Slack API unavailable with fake token", async () => {
		const exec = createCoworkerListSlackChannelsExecutor("fake_token");
		const result = await exec({ types: 123 }, ctx);
		expect(result.error).toBeDefined();
	});
});

describe("coworker_join_slack_channels", () => {
	it("returns error when channel_ids is not array", async () => {
		const exec = createCoworkerJoinSlackChannelsExecutor("fake_token");
		const result = await exec({ channel_ids: "C123" }, ctx);
		expect(result.error).toContain("array");
	});
});

describe("coworker_report_issue", () => {
	it("returns error when title missing", async () => {
		const exec = createCoworkerReportIssueExecutor("fake_token");
		const result = await exec({ description: "test" }, ctx);
		expect(result.error).toContain("title");
	});

	it("returns error when description missing", async () => {
		const exec = createCoworkerReportIssueExecutor("fake_token");
		const result = await exec({ title: "test" }, ctx);
		expect(result.error).toContain("description");
	});
});
