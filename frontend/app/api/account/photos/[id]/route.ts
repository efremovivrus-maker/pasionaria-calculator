import { accountError, requireAccount } from "@/lib/account/route";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  const { id } = await context.params;
  const row = await gate.access.supabase
    .from("proposal_files")
    .select("storage_path, content_type")
    .eq("id", id)
    .maybeSingle();
  if (row.error) {
    return accountError(row.error);
  }
  if (!row.data) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const file = await gate.access.supabase.storage.from("proposal-photos").download(row.data.storage_path);
  if (file.error || !file.data) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return new Response(file.data, {
    headers: {
      "Content-Type": row.data.content_type,
      "Cache-Control": "private, no-store",
    },
  });
}
