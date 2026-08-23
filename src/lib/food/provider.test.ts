import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { providerFetch, safeProviderCall } from "@/lib/food/provider";

function response(status: number) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}) };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

describe("providerFetch — retry", () => {
  it("does not retry by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(503));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerFetch("https://example.test");

    expect(result.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable status and returns the eventual success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerFetch("https://example.test", {}, { retries: 2 });

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the allowed attempts and reports the real status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(503));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerFetch("https://example.test", {}, { retries: 2 });

    expect(result.status).toBe(503);
    // First attempt plus two retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a status outside the retryable set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(404));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerFetch("https://example.test", {}, { retries: 3 });

    expect(result.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 404 when a provider is explicitly configured to", async () => {
    // USDA answers 404 from unwell backends; see usda.ts.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerFetch(
      "https://example.test",
      {},
      { retries: 3, retryStatuses: [404] },
    );

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a transport error and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerFetch("https://example.test", {}, { retries: 1 });
    expect(result.status).toBe(200);
  });

  it("propagates a transport error once attempts are exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    await expect(
      providerFetch("https://example.test", {}, { retries: 1 }),
    ).rejects.toThrow("ECONNRESET");
  });

  it("still identifies the app on a retried request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal("fetch", fetchMock);

    await providerFetch("https://example.test", {}, { retries: 1 });

    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers["User-Agent"]).toContain("CalDef");
    }
  });
});

describe("safeProviderCall", () => {
  it("wraps a success", async () => {
    const result = await safeProviderCall("usda", async () => []);
    expect(result).toEqual({ source: "usda", ok: true, foods: [] });
  });

  it("turns a throw into a failed result rather than propagating", async () => {
    const result = await safeProviderCall("off", async () => {
      throw new Error("boom");
    });

    expect(result.ok).toBe(false);
    expect(result.foods).toEqual([]);
    expect(result.source).toBe("off");
  });
});
