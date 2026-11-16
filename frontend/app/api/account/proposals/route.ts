import { accountError, documentFrom, requireAccount } from "@/lib/account/route";
import { removeStoredPhotos } from "@/lib/account/photosCleanup";

export async function GET(request: Request) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  const status = new URL(request.url).searchParams.get("status") === "archived" ? "archived" : "active";
  const query = gate.access.supabase
    .from("proposals")
    .select("id, number, title, client_name, total, status, version, updated_at")
    .eq("owner_id", gate.access.profile.id)
    .order("updated_at", { ascending: false });
  const result = await (status === "archived" ? query.eq("status", "archived") : query.neq("status", "archived"));
  if (result.error) {
    return accountError(result.error);
  }
  return Response.json({ proposals: result.data });
}

export async function POST(request: Request) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  try {
    const document = await documentFrom(request);
    const saved = await gate.access.supabase.rpc("save_account_proposal", {
      proposal_id: null,
      expected_version: null,
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
