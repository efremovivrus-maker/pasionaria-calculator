import { afterEach, describe, expect, it, vi } from "vitest";

const originalBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_BACKEND_URL = originalBackendUrl;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("warmUpBackend", () => {
  it("requests backend health only once", async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL =
      "https://pasionaria-backend.onrender.com";
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetchMock);
    const { warmUpBackend } = await import("./api");

    await Promise.all([warmUpBackend(), warmUpBackend()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://pasionaria-backend.onrender.com/health",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      cache: "no-store",
    });
  });

  it("silently absorbs network errors", async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL =
      "https://pasionaria-backend.onrender.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network unavailable")),
    );
    const { warmUpBackend } = await import("./api");

    await expect(warmUpBackend()).resolves.toBeUndefined();
  });

  it("aborts a hanging request after twelve seconds", async () => {
    vi.useFakeTimers();
    process.env.NEXT_PUBLIC_BACKEND_URL =
      "https://pasionaria-backend.onrender.com";
    const fetchMock = vi.fn(
      (_url: URL, options: RequestInit): Promise<Response> =>
        new Promise((_, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { warmUpBackend } = await import("./api");

    const warmUp = warmUpBackend();
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(warmUp).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
  });
});
