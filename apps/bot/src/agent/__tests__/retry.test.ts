import { LLMError } from "@openviktor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapProviderError, withRetry } from "../retry.js";

function makeRetryableError(status: number, message: string): Error {
	const error = new Error(message);
	Object.assign(error, { status });
	return error;
}

describe("withRetry", () => {
	it("returns result on first success", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		const result = await withRetry(fn);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledOnce();
	});

	it("retries on 429 and succeeds", async () => {
		const error = makeRetryableError(429, "Rate limited");
		let calls = 0;
		const fn = vi.fn().mockImplementation(async () => {
			calls++;
			if (calls === 1) throw error;
			return "ok";
		});

		const result = await withRetry(fn, { baseDelayMs: 1 });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("retries on 529 (overloaded)", async () => {
		const error = makeRetryableError(529, "Overloaded");
		let calls = 0;
		const fn = vi.fn().mockImplementation(async () => {
			calls++;
			if (calls === 1) throw error;
			return "ok";
		});

		const result = await withRetry(fn, { baseDelayMs: 1 });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("retries on network errors", async () => {
		let calls = 0;
		const fn = vi.fn().mockImplementation(async () => {
			calls++;
			if (calls === 1) throw new Error("fetch failed");
			return "ok";
		});

		const result = await withRetry(fn, { baseDelayMs: 1 });
		expect(result).toBe("ok");
	});

	it("does not retry on 401", async () => {
		const error = makeRetryableError(401, "Unauthorized");
		const fn = vi.fn().mockImplementation(async () => {
			throw error;
		});

		await expect(withRetry(fn)).rejects.toThrow("Unauthorized");
		expect(fn).toHaveBeenCalledOnce();
	});

	it("does not retry on 400", async () => {
		const error = makeRetryableError(400, "Bad request");
		const fn = vi.fn().mockImplementation(async () => {
			throw error;
		});

		await expect(withRetry(fn)).rejects.toThrow("Bad request");
		expect(fn).toHaveBeenCalledOnce();
	});

	it("throws after max retries exhausted", async () => {
		const error = makeRetryableError(429, "Rate limited");
		const fn = vi.fn().mockImplementation(async () => {
			throw error;
		});

		await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow("Rate limited");
		expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
	});

	it("uses exponential backoff", async () => {
		const error = makeRetryableError(429, "Rate limited");
		const fn = vi.fn().mockImplementation(async () => {
			throw error;
		});

		await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow();
		expect(fn).toHaveBeenCalledTimes(4);
	});

	it("respects retry-after header (seconds)", async () => {
		const error = makeRetryableError(429, "Rate limited");
		Object.assign(error, { headers: new Headers({ "retry-after": "1" }) });
		let calls = 0;
		const fn = vi.fn().mockImplementation(async () => {
			calls++;
			if (calls === 1) throw error;
			return "ok";
		});

		const result = await withRetry(fn, { baseDelayMs: 1 });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("prefers retry-after-ms header over retry-after", async () => {
		const error = makeRetryableError(429, "Rate limited");
		Object.assign(error, { headers: new Headers({ "retry-after-ms": "50", "retry-after": "10" }) });
		let calls = 0;
		const fn = vi.fn().mockImplementation(async () => {
			calls++;
			if (calls === 1) throw error;
			return "ok";
		});

		const result = await withRetry(fn, { baseDelayMs: 1 });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe("mapProviderError", () => {
	it("returns existing LLMError as-is", () => {
		const error = new LLMError("test");
		expect(mapProviderError(error)).toBe(error);
	});

	it("maps 401 to invalid API key error", () => {
		const error = makeRetryableError(401, "auth failed");
		const mapped = mapProviderError(error);
		expect(mapped).toBeInstanceOf(LLMError);
		expect(mapped.message).toBe("Invalid Anthropic API key");
	});

	it("maps 429 to rate limit error", () => {
		const error = makeRetryableError(429, "too many requests");
		const mapped = mapProviderError(error);
		expect(mapped.message).toBe("Rate limit exceeded after retries");
	});

	it("maps 529 to overloaded error", () => {
		const error = makeRetryableError(529, "overloaded");
		const mapped = mapProviderError(error);
		expect(mapped.message).toBe("Anthropic API overloaded");
	});

	it("maps 400 to bad request error", () => {
		const error = makeRetryableError(400, "invalid params");
		const mapped = mapProviderError(error);
		expect(mapped.message).toBe("Bad request: invalid params");
	});

	it("maps timeout errors", () => {
		const error = new Error("request timed out");
		error.name = "TimeoutError";
		const mapped = mapProviderError(error);
		expect(mapped.message).toBe("LLM request timed out");
	});

	it("maps network errors", () => {
		const error = new Error("fetch failed");
		const mapped = mapProviderError(error);
		expect(mapped.message).toBe("Failed to connect to Anthropic API");
	});

	it("maps unknown errors", () => {
		const mapped = mapProviderError("something weird");
		expect(mapped).toBeInstanceOf(LLMError);
		expect(mapped.message).toBe("Unknown LLM error");
	});
});
