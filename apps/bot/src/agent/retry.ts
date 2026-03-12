import { LLMError } from "@openviktor/shared";

interface RetryOptions {
	maxRetries?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 529]);

function isRetryable(error: unknown): boolean {
	if (error instanceof Error && "status" in error) {
		return RETRYABLE_STATUS_CODES.has((error as { status: number }).status);
	}
	if (error instanceof Error && error.message.includes("fetch failed")) {
		return true;
	}
	return false;
}

function getRetryAfterMs(error: unknown): number | null {
	if (
		error instanceof Error &&
		"headers" in error &&
		typeof (error as Record<string, unknown>).headers === "object"
	) {
		const headers = (error as { headers: Record<string, string> }).headers;
		const retryAfter = headers?.["retry-after"];
		if (retryAfter) {
			const seconds = Number.parseFloat(retryAfter);
			if (!Number.isNaN(seconds)) return seconds * 1000;
		}
	}
	return null;
}

function addJitter(delayMs: number): number {
	const jitter = 0.25;
	const factor = 1 - jitter + Math.random() * jitter * 2;
	return Math.round(delayMs * factor);
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30_000 } = options;

	let lastError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			if (attempt === maxRetries || !isRetryable(error)) {
				throw error;
			}

			const retryAfterMs = getRetryAfterMs(error);
			const exponentialDelay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
			const delay = retryAfterMs ?? addJitter(exponentialDelay);

			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

export function mapProviderError(error: unknown): LLMError {
	if (error instanceof LLMError) return error;

	if (error instanceof Error && "status" in error) {
		const status = (error as { status: number }).status;
		switch (status) {
			case 401:
				return new LLMError("Invalid Anthropic API key", error);
			case 429:
				return new LLMError("Rate limit exceeded after retries", error);
			case 529:
				return new LLMError("Anthropic API overloaded", error);
			case 400:
				return new LLMError(`Bad request: ${error.message}`, error);
		}
	}

	if (error instanceof Error) {
		if (error.name === "TimeoutError" || error.message.includes("timed out")) {
			return new LLMError("LLM request timed out", error);
		}
		if (error.message.includes("fetch failed")) {
			return new LLMError("Failed to connect to Anthropic API", error);
		}
		return new LLMError(error.message, error);
	}

	return new LLMError("Unknown LLM error", error);
}
