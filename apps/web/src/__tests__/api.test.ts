import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";

const mockFetch = vi.fn() as unknown as typeof fetch & ReturnType<typeof vi.fn>;
global.fetch = mockFetch;

beforeEach(() => {
	mockFetch.mockReset();
	localStorage.clear();
});

function mockJsonResponse(data: unknown, status = 200) {
	mockFetch.mockResolvedValueOnce({
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "Error",
		json: () => Promise.resolve(data),
		text: () => Promise.resolve(JSON.stringify(data)),
	});
}

describe("API client", () => {
	it("calls the correct URL for getOverview", async () => {
		mockJsonResponse({ stats: {} });
		await api.getOverview();
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/overview",
			expect.objectContaining({ headers: expect.any(Object) }),
		);
	});

	it("includes API key in Authorization header when set", async () => {
		localStorage.setItem("admin_api_key", "test-key");
		mockJsonResponse({});
		await api.getOverview();
		const headers = mockFetch.mock.calls[0][1].headers;
		expect(headers.Authorization).toBe("Bearer test-key");
	});

	it("omits Authorization header when no API key", async () => {
		mockJsonResponse({});
		await api.getOverview();
		const headers = mockFetch.mock.calls[0][1].headers;
		expect(headers.Authorization).toBeUndefined();
	});

	it("throws on non-ok response", async () => {
		mockJsonResponse({ error: "Not found" }, 404);
		await expect(api.getOverview()).rejects.toThrow("API 404");
	});

	it("builds query params for getRuns", async () => {
		mockJsonResponse({ data: [], total: 0, page: 1, limit: 25 });
		await api.getRuns({ page: 2, status: "COMPLETED", triggerType: "DM" });
		const url = mockFetch.mock.calls[0][0] as string;
		expect(url).toContain("page=2");
		expect(url).toContain("status=COMPLETED");
		expect(url).toContain("triggerType=DM");
	});

	it("encodes run ID in getRunDetail", async () => {
		mockJsonResponse({});
		await api.getRunDetail("abc/123");
		const url = mockFetch.mock.calls[0][0] as string;
		expect(url).toContain("abc%2F123");
	});

	it("sends PATCH for toggleCronJob", async () => {
		mockJsonResponse({});
		await api.toggleCronJob("job-1", false);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/cron-jobs/job-1",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ enabled: false }),
			}),
		);
	});
});
