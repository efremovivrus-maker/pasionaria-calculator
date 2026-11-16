import { AccountDenied } from "@/lib/account/rules";
import { accountError } from "@/lib/account/route";
import {
  acceptedPassword,
  currentAccessToken,
  passwordMatches,
  recoverySession,
  replaceAuthPassword,
} from "@/lib/account/passwords";
import { accountProfile } from "@/lib/account/server";

export async function POST(request: Request) {
  const access = await accountProfile();
  if (access.blocked || !access.profile) {
    return access.blocked ?? Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { currentPassword?: unknown; nextPassword?: unknown };
    const nextPassword = acceptedPassword(body.nextPassword, access.profile.email);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const knownPassword = currentPassword
      ? await passwordMatches(access.profile.email, currentPassword)
      : false;
    const token = knownPassword ? null : await currentAccessToken();
    if (!knownPassword && !(token && recoverySession(token))) {
      throw new AccountDenied("invalid_session", "Неверный email или пароль.");
    }
    const saved = await replaceAuthPassword(access.profile.id, nextPassword);
    if (!saved) {
      return Response.json({ error: "account_not_configured" }, { status: 503 });
    }
    return Response.json({ changed: true });
  } catch (error) {
    return accountError(error);
  }
}
