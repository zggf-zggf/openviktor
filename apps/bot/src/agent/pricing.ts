interface ModelPricing {
	inputPerMTok: number;
	outputPerMTok: number;
	cacheWritePerMTok: number;
	cacheReadPerMTok: number;
}

const PRICING: Record<string, ModelPricing> = {
	"claude-opus-4": {
		inputPerMTok: 5,
		outputPerMTok: 25,
		cacheWritePerMTok: 6.25,
		cacheReadPerMTok: 0.5,
	},
	"claude-sonnet-4": {
		inputPerMTok: 3,
		outputPerMTok: 15,
		cacheWritePerMTok: 3.75,
		cacheReadPerMTok: 0.3,
	},
	"claude-haiku-4": {
		inputPerMTok: 1,
		outputPerMTok: 5,
		cacheWritePerMTok: 1.25,
		cacheReadPerMTok: 0.1,
	},
};

function findPricing(model: string): ModelPricing {
	for (const [prefix, pricing] of Object.entries(PRICING)) {
		if (model.startsWith(prefix)) return pricing;
	}
	return PRICING["claude-sonnet-4"];
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
}

export function calculateCostCents(model: string, usage: TokenUsage): number {
	const pricing = findPricing(model);

	const regularInput = usage.inputTokens - usage.cacheReadInputTokens;
	const costDollars =
		(regularInput / 1_000_000) * pricing.inputPerMTok +
		(usage.outputTokens / 1_000_000) * pricing.outputPerMTok +
		(usage.cacheCreationInputTokens / 1_000_000) * pricing.cacheWritePerMTok +
		(usage.cacheReadInputTokens / 1_000_000) * pricing.cacheReadPerMTok;

	return Math.round(costDollars * 100 * 10_000) / 10_000;
}
