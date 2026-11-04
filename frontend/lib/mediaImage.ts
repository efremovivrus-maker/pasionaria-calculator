const ALLOWED_IMAGE_HOSTS = new Set(["pro.pasionaria.ru"]);
export const MAX_MEDIA_IMAGE_BYTES = 4_000_000;

export function allowedMediaImageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    const defaultPort = url.protocol === "https:" ? "443" : "80";
    if (url.port && url.port !== defaultPort) {
      return null;
    }
    if (!ALLOWED_IMAGE_HOSTS.has(url.hostname)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export async function fetchAllowedMediaImage(
  value: string,
): Promise<{ body: ArrayBuffer; type: string } | null> {
  let current = allowedMediaImageUrl(value);
  if (!current) {
    return null;
  }
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "image/*" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return null;
      }
      const next = allowedMediaImageUrl(new URL(location, current).toString());
      if (!next) {
        return null;
      }
      current = next;
      continue;
    }
    if (!response.ok) {
      return null;
    }
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!type.startsWith("image/")) {
      return null;
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_MEDIA_IMAGE_BYTES) {
      return null;
    }
    const body = await response.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_MEDIA_IMAGE_BYTES) {
      return null;
    }
    return { body, type };
  }
  return null;
}
