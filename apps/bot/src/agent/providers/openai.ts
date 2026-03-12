import type { LLMProvider, LLMResponse } from "@openviktor/shared";
import { LLMError } from "@openviktor/shared";

export class OpenAIProvider implements LLMProvider {
	async chat(): Promise<LLMResponse> {
		throw new LLMError("OpenAI provider not implemented");
	}
}
