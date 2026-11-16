import { accountError, requireAccount } from "@/lib/account/route";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  const { id } = await context.params;
  const body = (await request.json()) as { version?: unknown };
  if (typeof body.version !== "number") {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const saved = await gate.access.supabase
    .from("proposals")
    .update({ status: "archived", version: body.version + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", gate.access.profile.id)
    .eq("version", body.version)
    .select("id, status, version")
    .maybeSingle();
  if (saved.error) {
    return accountError(saved.error);
  }
  if (!saved.data) {
    const existing = await gate.access.supabase
      .from("proposals")
      .select("id")
      .eq("id", id)
      .eq("owner_id", gate.access.profile.id)
      .maybeSingle();
    return Response.json({ error: existing.data ? "conflict" : "not_found" }, { status: existing.data ? 409 : 404 });
  }
  return Response.json({ proposal: saved.data });
}
