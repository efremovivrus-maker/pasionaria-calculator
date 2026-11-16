import { accountError, documentFrom, requireAccount } from "@/lib/account/route";
import { removeStoredPhotos } from "@/lib/account/photosCleanup";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  const { id } = await context.params;
  const result = await gate.access.supabase
    .from("proposals")
    .select("id, number, title, status, version, snapshot, total, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (result.error) {
    return accountError(result.error);
  }
  if (!result.data) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ proposal: result.data });
}

export async function PATCH(request: Request, context: Context) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  try {
    const { id } = await context.params;
    const document = await documentFrom(request);
    const saved = await gate.access.supabase.rpc("save_account_proposal", {
      proposal_id: id,
      expected_version: document.version,
      document: document.snapshot,
    });
    if (saved.error) {
      return accountError(saved.error);
    }
    await removeStoredPhotos(gate.access.supabase, saved.data);
    return Response.json({ proposal: saved.data });
  } catch (error) {
    return accountError(error);
  }
}
