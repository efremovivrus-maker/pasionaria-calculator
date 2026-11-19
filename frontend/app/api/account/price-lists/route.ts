import { requireAccount } from "@/lib/account/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATALOGS = new Set(["works", "fabrics", "curtains", "bedspreads", "trims"]);

export async function GET(request: Request) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  const token = process.env.PRICE_LIST_TOKEN?.trim();
  const backend = process.env.BACKEND_URL?.trim() || process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (!token || !backend) {
    return Response.json({ error: "price_lists_not_configured" }, { status: 503 });
  }
  const url = new URL(request.url);
  const catalog = url.searchParams.get("catalog") ?? "";
  if (!CATALOGS.has(catalog)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const audience = gate.access.profile.role === "admin" ? "admin" : "manager";
  const exportFormat = url.searchParams.get("export") === "xlsx" ? "xlsx" : "json";
  const target = new URL(`/api/price-lists/${catalog}`, backend);
  target.searchParams.set("audience", audience);
  target.searchParams.set("export", exportFormat);
  try {
    const response = await fetch(target, {
      headers: { "X-Price-List-Token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.arrayBuffer();
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    const type = response.headers.get("content-type");
    if (type) {
      headers.set("Content-Type", type);
    }
    const disposition = response.headers.get("content-disposition");
    if (disposition) {
      headers.set("Content-Disposition", disposition);
    }
    return new Response(body, { status: response.status, headers });
  } catch {
    return Response.json({ error: "backend_unavailable" }, { status: 503 });
  }
}
