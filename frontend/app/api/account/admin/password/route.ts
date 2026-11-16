import { acceptedPassword } from "@/lib/account/passwords";
import { accountAdminClient, limitAccountAction } from "@/lib/account/server";
import { accountError, requireAccount } from "@/lib/account/route";
import { AccountDenied } from "@/lib/account/rules";

export async function POST(request: Request) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  if (gate.access.profile.role !== "admin") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!limitAccountAction(`reset:${gate.access.profile.id}`, 10)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const body = (await request.json()) as { id?: unknown; password?: unknown };
    if (typeof body.id !== "string") {
      throw new AccountDenied("invalid", "Пользователь не указан.");
    }
    const admin = accountAdminClient();
    if (!admin) {
      return Response.json({ error: "account_not_configured" }, { status: 503 });
    }
    const profile = await admin.from("profiles").select("email").eq("id", body.id).maybeSingle();
    if (!profile.data) {
      throw new AccountDenied("not_found", "Пользователь не найден.");
    }
    const password = acceptedPassword(body.password, profile.data.email);
    const updated = await admin.auth.admin.updateUserById(body.id, { password });
    if (updated.error) {
      throw new AccountDenied("invalid", "Не удалось сменить пароль.");
    }
    const marked = await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", body.id);
    if (marked.error) {
      throw new AccountDenied("invalid", "Не удалось сменить пароль.");
    }
    return Response.json({ reset: true });
  } catch (error) {
    return accountError(error);
  }
}
