import { accountProfile } from "@/lib/account/server";
import { proposalSnapshot, proposalTotal, restoreProposal, AccountDenied } from "@/lib/account/rules";

export async function requireAccount() {
  const access = await accountProfile();
  if (access.blocked || !access.supabase || !access.profile) {
    return { access: null, error: access.blocked ?? Response.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  if (access.profile.must_change_password) {
    return {
      access: null,
      error: Response.json({ error: "password_change_required" }, { status: 403 }),
    };
  }
  return { access, error: null };
}

export async function documentFrom(request: Request) {
  const body = (await request.json()) as {
    proposal?: unknown;
    version?: unknown;
    ownerId?: unknown;
  };
  if ("ownerId" in body) {
    throw new AccountDenied("invalid", "Владелец документа задаётся только на сервере.");
  }
  const proposal = restoreProposal(body.proposal ?? body);
  return {
    proposal,
    snapshot: { ...proposalSnapshot(proposal), total: proposalTotal(proposal) },
    version: typeof body.version === "number" ? body.version : null,
  };
}

export function accountError(error: unknown): Response {
  if (error instanceof AccountDenied) {
    const status = {
      unauthenticated: 401,
      invalid_session: 401,
      inactive: 403,
      password_change_required: 403,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      invalid: 400,
      too_large: 413,
      rate_limited: 429,
    }[error.failure];
    return Response.json({ error: error.failure, message: error.message }, { status });
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("conflict")) {
    return Response.json({ error: "conflict" }, { status: 409 });
  }
  if (message.includes("not_found")) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (message.includes("invalid") || message.includes("unsupported")) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  return Response.json({ error: "unavailable" }, { status: 503 });
}
