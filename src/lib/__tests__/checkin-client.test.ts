import { beforeEach, describe, expect, it, vi } from "vitest";
import { postCheckInWithRetry } from "@/lib/checkin-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("postCheckInWithRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries transient network failures before returning the server result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    const result = await postCheckInWithRetry("token", { fetchFn: fetchMock, retryDelayMs: 0 });

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx responses but not 4xx validation failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: "temporary" }, 503))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: "bad token" }, 400));

    const result = await postCheckInWithRetry("token", { fetchFn: fetchMock, retryDelayMs: 0 });

    expect(result).toEqual({ success: false, error: "bad token" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a visible connection error after all transient attempts fail", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("offline"));

    const result = await postCheckInWithRetry("token", {
      fetchFn: fetchMock,
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
