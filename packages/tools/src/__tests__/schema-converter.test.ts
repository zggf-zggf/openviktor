import { describe, expect, it } from "vitest";
import {
	actionKeyToToolName,
	convertConfigurableProps,
} from "../tools/integrations/schema-converter.js";

describe("convertConfigurableProps", () => {
	it("excludes app-type props", () => {
		const schema = convertConfigurableProps([
			{ name: "google_sheets", type: "app", app: "google_sheets" },
			{ name: "sheetId", type: "string", label: "Spreadsheet" },
		]);

		expect(schema.properties).not.toHaveProperty("google_sheets");
		expect(schema.properties).toHaveProperty("sheetId");
	});

	it("converts string props", () => {
		const schema = convertConfigurableProps([
			{ name: "title", type: "string", label: "Document Title" },
		]);

		expect(schema.properties.title).toEqual({
			type: "string",
			description: "Document Title",
		});
		expect(schema.required).toContain("title");
	});

	it("converts boolean props", () => {
		const schema = convertConfigurableProps([
			{ name: "hasHeaders", type: "boolean", label: "Has Headers", optional: true },
		]);

		expect(schema.properties.hasHeaders).toEqual({
			type: "boolean",
			description: "Has Headers",
		});
		expect(schema.required).not.toContain("hasHeaders");
	});

	it("converts integer props", () => {
		const schema = convertConfigurableProps([
			{ name: "maxRows", type: "integer", label: "Max Rows" },
		]);

		expect(schema.properties.maxRows.type).toBe("integer");
	});

	it("converts array props", () => {
		const schema = convertConfigurableProps([
			{ name: "myColumnData", type: "string[]", label: "Row Data" },
		]);

		expect(schema.properties.myColumnData).toEqual({
			type: "array",
			items: { type: "string" },
			description: "Row Data",
		});
	});

	it("marks optional props correctly", () => {
		const schema = convertConfigurableProps([
			{ name: "required_field", type: "string", label: "Required" },
			{ name: "optional_field", type: "string", label: "Optional", optional: true },
		]);

		expect(schema.required).toContain("required_field");
		expect(schema.required).not.toContain("optional_field");
	});

	it("handles props with defaults", () => {
		const schema = convertConfigurableProps([
			{ name: "format", type: "string", label: "Format", default: "csv" },
		]);

		expect(schema.properties.format.default).toBe("csv");
	});

	it("handles props with enum options", () => {
		const schema = convertConfigurableProps([
			{ name: "format", type: "string", label: "Format", options: ["csv", "json", "xml"] },
		]);

		expect(schema.properties.format.enum).toEqual(["csv", "json", "xml"]);
	});

	it("handles complex Google Sheets example", () => {
		const schema = convertConfigurableProps([
			{ name: "google_sheets", type: "app", app: "google_sheets" },
			{ name: "sheetId", type: "string", label: "Spreadsheet" },
			{ name: "worksheetId", type: "string", label: "Worksheet" },
			{ name: "hasHeaders", type: "boolean", label: "Has Headers", optional: true },
			{ name: "myColumnData", type: "string[]", label: "Row Data" },
		]);

		expect(Object.keys(schema.properties)).toHaveLength(4);
		expect(schema.required).toEqual(["sheetId", "worksheetId", "myColumnData"]);
		expect(schema.type).toBe("object");
	});

	it("returns empty schema for app-only props", () => {
		const schema = convertConfigurableProps([{ name: "slack", type: "app", app: "slack" }]);

		expect(Object.keys(schema.properties)).toHaveLength(0);
		expect(schema.required).toHaveLength(0);
	});

	it("falls back to description when label is missing", () => {
		const schema = convertConfigurableProps([
			{ name: "value", type: "string", description: "The value to set" },
		]);

		expect(schema.properties.value.description).toBe("The value to set");
	});

	it("converts object props", () => {
		const schema = convertConfigurableProps([
			{ name: "data", type: "object", label: "Data Object" },
		]);

		expect(schema.properties.data.type).toBe("object");
	});

	it("converts number props", () => {
		const schema = convertConfigurableProps([{ name: "amount", type: "number", label: "Amount" }]);

		expect(schema.properties.amount.type).toBe("number");
	});
});

describe("actionKeyToToolName", () => {
	it("converts action key to tool name", () => {
		expect(actionKeyToToolName("google_sheets", "google_sheets-add-single-row")).toBe(
			"mcp_pd_google_sheets_add_single_row",
		);
	});

	it("handles simple action keys", () => {
		expect(actionKeyToToolName("slack", "slack-send-message")).toBe("mcp_pd_slack_send_message");
	});

	it("handles multi-word action keys", () => {
		expect(actionKeyToToolName("github", "github-create-pull-request")).toBe(
			"mcp_pd_github_create_pull_request",
		);
	});
});
