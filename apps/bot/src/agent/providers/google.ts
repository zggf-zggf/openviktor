import type { LLMProvider, LLMResponse } from "@openviktor/shared";
import { LLMError } from "@openviktor/shared";

export class GoogleProvider implements LLMProvider {
	async chat(): Promise<LLMResponse> {
		throw new LLMError("Google AI provider not implemented");
	}
}
