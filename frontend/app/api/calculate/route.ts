export const runtime = "nodejs";

export async function POST(request: Request) {
  const backend = process.env.BACKEND_URL?.trim() || process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (!backend) {
    return Response.json({ error: "backend_unavailable" }, { status: 503 });
  }
  try {
    const body = await request.text();
    const response = await fetch(`${backend.replace(/\/$/, "")}/api/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.text();
    return new Response(payload, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ error: "backend_unavailable" }, { status: 503 });
  }
}
