import { createClient } from "@supabase/supabase-js";

import { limitAccountAction } from "@/lib/account/server";
import { accountUnavailable } from "@/lib/account/server";

export async function POST(request: Request) {
  const blocked = accountUnavailable();
  if (blocked) {
    return blocked;
  }
  if (!limitAccountAction("password-recovery", 10)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = (await request.json()) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (email.includes("@") && url && key) {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const origin = request.headers.get("origin") ?? new URL(request.url).origin;
    await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/account/password`,
    });
  }
  return Response.json({
    accepted: true,
    message:
      "Письмо для нового пароля отправляется только если для адреса есть учётная запись и в Supabase настроена почта. Пока почта не настроена, письмо не придёт.",
  });
}
