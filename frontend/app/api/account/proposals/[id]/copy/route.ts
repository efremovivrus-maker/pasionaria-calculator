import { accountError, requireAccount } from "@/lib/account/route";
import { proposalTotal, restoreProposal } from "@/lib/account/rules";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  const { id } = await context.params;
  const current = await gate.access.supabase
    .from("proposals")
    .select("snapshot, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (current.error) {
    return accountError(current.error);
  }
  if (!current.data || current.data.owner_id !== gate.access.profile.id) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const proposal = restoreProposal(current.data.snapshot);
  proposal.objectName = proposal.objectName ? `${proposal.objectName} (копия)` : "Копия";
  const saved = await gate.access.supabase.rpc("save_account_proposal", {
    proposal_id: null,
    expected_version: null,
    document: { schemaVersion: 1, proposal, total: proposalTotal(proposal) },
  });
  if (saved.error) {
    return accountError(saved.error);
  }
  return Response.json({ proposal: saved.data });
}
