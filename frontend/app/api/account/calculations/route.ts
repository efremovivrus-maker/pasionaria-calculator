import { accountError, requireAccount } from "@/lib/account/route";

export async function GET(request: Request) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  const url = new URL(request.url);
  const page = Math.max(Number(url.searchParams.get("page") ?? "1") || 1, 1);
  const pageSize = 20;
  let query = gate.access.supabase
    .from("calculations")
    .select("id, raw_request, product_type, model, price, proposal_id, created_at", { count: "exact" })
    .eq("owner_id", gate.access.profile.id)
    .eq("status", "success")
    .order("created_at", { ascending: false });
  const productType = url.searchParams.get("productType");
  const search = url.searchParams.get("search")?.trim();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (productType) {
    query = query.eq("product_type", productType);
  }
  if (search) {
    query = query.or(`raw_request.ilike.%${search.replace(/[,()]/g, " ")}%,model.ilike.%${search.replace(/[,()]/g, " ")}%`);
  }
  if (from) {
    query = query.gte("created_at", from);
  }
  if (to) {
    query = query.lte("created_at", `${to}T23:59:59Z`);
  }
  const result = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (result.error) {
    return accountError(result.error);
  }
  return Response.json({ calculations: result.data, total: result.count ?? 0, page });
}

export async function POST(request: Request) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  const body = (await request.json()) as {
    ownerId?: unknown;
    rawRequest?: unknown;
    normalizedInput?: unknown;
    result?: unknown;
    productType?: unknown;
    model?: unknown;
    price?: unknown;
    status?: unknown;
  };
  if ("ownerId" in body || body.status !== "success" && body.status !== "failed") {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  if (typeof body.rawRequest !== "string" || !body.normalizedInput || !body.result) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const inserted = gate.access.supabase.from("calculations").insert({
    owner_id: gate.access.profile.id,
    raw_request: body.rawRequest.slice(0, 8_000),
    normalized_input: body.normalizedInput,
    result: body.result,
    product_type: typeof body.productType === "string" ? body.productType : null,
    model: typeof body.model === "string" ? body.model : null,
    price: typeof body.price === "number" ? body.price : null,
    status: body.status,
  });
  // Failed rows are hidden by the select policy. Asking PostgREST to return one
  // makes it reject the whole insert as a row-level security violation.
  const saved = body.status === "success"
    ? await inserted.select("id, status").single()
    : await inserted;
  if (saved.error) {
    return accountError(saved.error);
  }
  return Response.json({ calculation: saved.data });
}
