import { fetchAllowedMediaImage } from "@/lib/mediaImage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  try {
    const image = await fetchAllowedMediaImage(raw);
    if (!image) {
      return new Response(null, { status: 404 });
    }
    return new Response(image.body, {
      headers: {
        "Content-Type": image.type,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
