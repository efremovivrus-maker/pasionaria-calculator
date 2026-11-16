import { accountProfile, accountUnavailable } from "@/lib/account/server";

export async function GET() {
  const blocked = accountUnavailable();
  if (blocked) {
    return blocked;
  }
  const access = await accountProfile();
  if (access.blocked || !access.profile) {
    return access.blocked ?? Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  return Response.json({ profile: access.profile });
}
