import { createClient } from "@supabase/supabase-js";

import { AccountDenied, passwordError } from "@/lib/account/rules";
import { accountAdminClient, accountClient } from "@/lib/account/server";

export function acceptedPassword(password: unknown, email = ""): string {
  if (typeof password !== "string") {
    throw new AccountDenied("invalid", "Пароль не передан.");
  }
  const error = passwordError(password, email);
  if (error) {
    throw new AccountDenied("invalid", error);
  }
  return password;
}

export async function passwordMatches(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return false;
  }
  const verifier = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await verifier.auth.signInWithPassword({ email, password });
  return !result.error;
}

export function recoverySession(accessToken: string): boolean {
  const encoded = accessToken.split(".")[1];
  if (!encoded) {
    return false;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as {
      amr?: Array<{ method?: string }>;
    };
    return payload.amr?.some((entry) => entry.method === "recovery") ?? false;
  } catch {
    return false;
  }
}

export async function currentAccessToken(): Promise<string | null> {
  const supabase = await accountClient();
  const session = await supabase.auth.getSession();
  return session.data.session?.access_token ?? null;
}

export async function replaceAuthPassword(userId: string, password: string): Promise<boolean> {
  const admin = accountAdminClient();
  if (!admin) {
    return false;
  }
  const updated = await admin.auth.admin.updateUserById(userId, { password });
  if (updated.error) {
    return false;
  }
  const profile = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", userId);
  return !profile.error;
}
