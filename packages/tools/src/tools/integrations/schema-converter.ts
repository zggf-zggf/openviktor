import type { PipedreamConfigurableProp } from "@openviktor/integrations";

interface JsonSchemaProperty {
	type: string;
	description?: string;
	items?: { type: string };
	default?: unknown;
	enum?: unknown[];
	[key: string]: unknown;
}

interface JsonSchema {
	type: "object";
	properties: Record<string, JsonSchemaProperty>;
	required: string[];
	[key: string]: unknown;
}

function convertPropType(prop: PipedreamConfigurableProp): JsonSchemaProperty {
	const schema: JsonSchemaProperty = { type: "string" };

	if (prop.type === "boolean") {
		schema.type = "boolean";
	} else if (prop.type === "integer") {
		schema.type = "integer";
	} else if (prop.type === "number") {
		schema.type = "number";
	} else if (prop.type === "object") {
		schema.type = "object";
	} else if (prop.type.endsWith("[]")) {
		const baseType = prop.type.slice(0, -2);
		schema.type = "array";
		schema.items = {
			type: baseType === "integer" ? "integer" : baseType === "boolean" ? "boolean" : "string",
		};
	}

	if (prop.label) {
		schema.description = prop.label;
	} else if (prop.description) {
		schema.description = prop.description;
	}

	if (prop.default !== undefined) {
		schema.default = prop.default;
	}

	if (prop.options && Array.isArray(prop.options) && prop.options.length > 0) {
		schema.enum = prop.options;
	}

	return schema;
}

export function convertConfigurableProps(props: PipedreamConfigurableProp[]): JsonSchema {
	const properties: Record<string, JsonSchemaProperty> = {};
	const required: string[] = [];

	for (const prop of props) {
		if (prop.type === "app") continue;

		properties[prop.name] = convertPropType(prop);

		if (!prop.optional) {
			required.push(prop.name);
		}
	}

	return { type: "object", properties, required };
}

export function actionKeyToToolName(appSlug: string, actionKey: string): string {
	const suffix = actionKey.replace(`${appSlug}-`, "").replace(/-/g, "_");
	return `mcp_pd_${appSlug}_${suffix}`;
}
