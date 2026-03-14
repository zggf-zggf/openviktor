import type { PipedreamAction } from "@openviktor/integrations";
import { describe, expect, it } from "vitest";
import { extractToolSchemas, generateSkillContent } from "../tools/integrations/pipedream-tools.js";

describe("generateSkillContent", () => {
	const mockActions: PipedreamAction[] = [
		{
			id: "action-1",
			key: "google_sheets-add-single-row",
			name: "Add Single Row",
			description: "Add a single row of data to a Google Sheet",
			version: "0.2.0",
			configurable_props: [
				{ name: "google_sheets", type: "app", app: "google_sheets" },
				{ name: "sheetId", type: "string", label: "Spreadsheet" },
				{ name: "worksheetId", type: "string", label: "Worksheet" },
				{ name: "myColumnData", type: "string[]", label: "Row Data" },
			],
		},
		{
			id: "action-2",
			key: "google_sheets-update-row",
			name: "Update Row",
			description: "Update an existing row in a Google Sheet",
			version: "0.1.0",
			configurable_props: [
				{ name: "google_sheets", type: "app", app: "google_sheets" },
				{ name: "sheetId", type: "string", label: "Spreadsheet" },
				{ name: "row", type: "integer", label: "Row Number" },
			],
		},
	];

	it("generates SKILL.md content with YAML frontmatter", () => {
		const content = generateSkillContent("google_sheets", "Google Sheets", mockActions);

		expect(content).toContain("name: pd_google_sheets");
		expect(content).toContain("description: >");
		expect(content).toContain("## Available Tools");
	});

	it("includes all action tools with correct names", () => {
		const content = generateSkillContent("google_sheets", "Google Sheets", mockActions);

		expect(content).toContain("### mcp_pd_google_sheets_add_single_row");
		expect(content).toContain("### mcp_pd_google_sheets_update_row");
	});

	it("includes action descriptions", () => {
		const content = generateSkillContent("google_sheets", "Google Sheets", mockActions);

		expect(content).toContain("Add a single row of data to a Google Sheet");
		expect(content).toContain("Update an existing row in a Google Sheet");
	});

	it("lists parameters for each action (excluding app props)", () => {
		const content = generateSkillContent("google_sheets", "Google Sheets", mockActions);

		expect(content).toContain("sheetId (string)");
		expect(content).toContain("worksheetId (string)");
		expect(content).toContain("myColumnData (string[])");
		expect(content).not.toContain("google_sheets (app)");
	});

	it("includes configure tool", () => {
		const content = generateSkillContent("google_sheets", "Google Sheets", mockActions);

		expect(content).toContain("### mcp_pd_google_sheets_configure");
		expect(content).toContain("Discover dynamic properties");
	});

	it("includes all proxy tools", () => {
		const content = generateSkillContent("google_sheets", "Google Sheets", mockActions);

		expect(content).toContain("### mcp_pd_google_sheets_proxy_get");
		expect(content).toContain("### mcp_pd_google_sheets_proxy_post");
		expect(content).toContain("### mcp_pd_google_sheets_proxy_put");
		expect(content).toContain("### mcp_pd_google_sheets_proxy_patch");
		expect(content).toContain("### mcp_pd_google_sheets_proxy_delete");
	});

	it("mentions the app name in proxy descriptions", () => {
		const content = generateSkillContent("google_sheets", "Google Sheets", mockActions);

		expect(content).toContain("Google Sheets API auth");
	});

	it("embeds parseable tool schemas in TOOL_SCHEMAS block", () => {
		const content = generateSkillContent("google_sheets", "Google Sheets", mockActions);

		expect(content).toContain("---TOOL_SCHEMAS---");
		expect(content).toContain("---END_TOOL_SCHEMAS---");

		const schemas = extractToolSchemas(content);
		expect(schemas).not.toBeNull();
		expect(schemas?.length).toBeGreaterThan(0);

		const names = schemas?.map((s) => s.name);
		expect(names).toContain("mcp_pd_google_sheets_add_single_row");
		expect(names).toContain("mcp_pd_google_sheets_update_row");
		expect(names).toContain("mcp_pd_google_sheets_configure");
		expect(names).toContain("mcp_pd_google_sheets_proxy_get");
		expect(names).toContain("mcp_pd_google_sheets_proxy_post");
		expect(names).toContain("mcp_pd_google_sheets_proxy_put");
		expect(names).toContain("mcp_pd_google_sheets_proxy_patch");
		expect(names).toContain("mcp_pd_google_sheets_proxy_delete");
	});

	it("includes correct input_schema in embedded tool schemas", () => {
		const content = generateSkillContent("google_sheets", "Google Sheets", mockActions);
		const schemas = extractToolSchemas(content);
		expect(schemas).not.toBeNull();

		const addRow = schemas?.find((s) => s.name === "mcp_pd_google_sheets_add_single_row");
		expect(addRow).toBeDefined();
		expect(addRow?.description).toBe("Add a single row of data to a Google Sheet");
		expect(addRow?.input_schema.type).toBe("object");
		const props = addRow?.input_schema.properties as Record<string, unknown>;
		expect(props).toHaveProperty("sheetId");
		expect(props).toHaveProperty("worksheetId");
		expect(props).toHaveProperty("myColumnData");
		expect(props).not.toHaveProperty("google_sheets");
	});
});

describe("extractToolSchemas", () => {
	it("returns null for content without TOOL_SCHEMAS block", () => {
		expect(extractToolSchemas("Just some markdown content")).toBeNull();
	});

	it("returns null for malformed JSON in TOOL_SCHEMAS block", () => {
		const content = "---TOOL_SCHEMAS---\n{invalid json}\n---END_TOOL_SCHEMAS---";
		expect(extractToolSchemas(content)).toBeNull();
	});

	it("parses valid TOOL_SCHEMAS block", () => {
		const schemas = [{ name: "test_tool", description: "Test", input_schema: { type: "object" } }];
		const content = `Some content\n---TOOL_SCHEMAS---\n${JSON.stringify(schemas)}\n---END_TOOL_SCHEMAS---`;
		const result = extractToolSchemas(content);
		expect(result).toEqual(schemas);
	});
});
