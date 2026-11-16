import { accountError, requireAccount } from "@/lib/account/route";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  const { id } = await context.params;
  const current = await gate.access.supabase
    .from("calculations")
    .select("id, normalized_input, price")
    .eq("id", id)
    .eq("owner_id", gate.access.profile.id)
    .eq("status", "success")
    .maybeSingle();
  if (current.error) {
    return accountError(current.error);
  }
  if (!current.data) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({
    calculationId: current.data.id,
    request: current.data.normalized_input,
    historicalPrice: current.data.price,
  });
}
