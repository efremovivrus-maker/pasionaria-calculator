import { acceptedPassword } from "@/lib/account/passwords";
import { accountAdminClient, limitAccountAction } from "@/lib/account/server";
import { accountError, requireAccount } from "@/lib/account/route";
import { AccountDenied } from "@/lib/account/rules";

export async function GET() {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  if (gate.access.profile.role !== "admin") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const profiles = await gate.access.supabase
    .from("profiles")
    .select("id, email, display_name, role, active, created_at")
    .order("created_at", { ascending: false });
  if (profiles.error) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  return Response.json({ profiles: profiles.data });
}

export async function POST(request: Request) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  if (gate.access.profile.role !== "admin") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!limitAccountAction(`create-user:${gate.access.profile.id}`, 10)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const body = (await request.json()) as { email?: unknown; displayName?: unknown; password?: unknown };
    if (typeof body.email !== "string" || !body.email.includes("@")) {
      throw new AccountDenied("invalid", "Нужен email.");
    }
    const admin = accountAdminClient();
    if (!admin) {
      return Response.json({ error: "account_not_configured" }, { status: 503 });
    }
    const email = body.email.trim().toLowerCase();
    const password = acceptedPassword(body.password, email);
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new AccountDenied("invalid", "Пользователь с таким email уже есть.");
    }
    const profile = await admin.from("profiles").insert({
      id: created.data.user.id,
      email,
      display_name: typeof body.displayName === "string" ? body.displayName.trim() : "",
      role: "manager",
      active: true,
      must_change_password: true,
    });
    if (profile.error) {
      await admin.auth.admin.deleteUser(created.data.user.id);
      throw new AccountDenied("invalid", "Не удалось создать профиль.");
    }
    return Response.json({ created: true });
  } catch (error) {
    return accountError(error);
  }
}

export async function PATCH(request: Request) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  if (gate.access.profile.role !== "admin") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json()) as { id?: unknown; active?: unknown };
  if (typeof body.id !== "string" || typeof body.active !== "boolean") {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const updated = await gate.access.supabase
    .from("profiles")
    .update({ active: body.active })
    .eq("id", body.id)
    .select("id, active")
    .single();
  if (updated.error) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const admin = accountAdminClient();
  await admin?.auth.admin.updateUserById(body.id, {
    ban_duration: body.active ? "none" : "876000h",
  });
  return Response.json({ profile: updated.data });
}
