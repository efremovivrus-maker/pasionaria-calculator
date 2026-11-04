import { afterEach, describe, expect, it } from "vitest";

import { allowedMediaImageUrl, fetchAllowedMediaImage } from "./mediaImage";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("media image proxy", () => {
  it("accepts catalog http and https links and rejects other targets", () => {
    expect(allowedMediaImageUrl("http://pro.pasionaria.ru/upload/a.jpg")?.protocol).toBe("http:");
    expect(allowedMediaImageUrl("https://pro.pasionaria.ru/upload/a.jpg")?.protocol).toBe("https:");
    expect(allowedMediaImageUrl("https://example.com/a.jpg")).toBeNull();
    expect(allowedMediaImageUrl("http://pro.pasionaria.ru.evil.com/a.jpg")).toBeNull();
    expect(allowedMediaImageUrl("http://user:secret@pro.pasionaria.ru/a.jpg")).toBeNull();
    expect(allowedMediaImageUrl("http://pro.pasionaria.ru:8080/a.jpg")).toBeNull();
    expect(allowedMediaImageUrl("file:///etc/passwd")).toBeNull();
    expect(allowedMediaImageUrl("javascript:alert(1)")).toBeNull();
  });

  it("follows an http redirect only when it stays on the catalog host", async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = String(input);
      calls.push(href);
      if (href === "http://pro.pasionaria.ru/cover.jpg") {
        return new Response(null, {
          status: 301,
          headers: { Location: "https://pro.pasionaria.ru/cover.jpg" },
        });
      }
      if (href === "https://pro.pasionaria.ru/cover.jpg") {
        return new Response(jpeg, { status: 200, headers: { "Content-Type": "image/jpeg" } });
      }
      if (href === "http://pro.pasionaria.ru/leave.jpg") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/a.jpg" },
        });
      }
      return new Response("no", { status: 200, headers: { "Content-Type": "text/html" } });
    }) as typeof fetch;

    const image = await fetchAllowedMediaImage("http://pro.pasionaria.ru/cover.jpg");
    expect(new Uint8Array(image?.body ?? [])).toEqual(jpeg);
    expect(image?.type).toBe("image/jpeg");

    expect(await fetchAllowedMediaImage("http://pro.pasionaria.ru/leave.jpg")).toBeNull();
    expect(calls.some((href) => href.includes("evil.example"))).toBe(false);
    expect(await fetchAllowedMediaImage("https://example.com/a.jpg")).toBeNull();
  });
});
