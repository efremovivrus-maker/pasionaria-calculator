import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { accountEnabledOnServer } from "@/lib/account/rules";

export function accountConfiguration(): "disabled" | "missing" | "ready" {
  if (!accountEnabledOnServer()) {
    return "disabled";
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return "missing";
  }
  return "ready";
}

export function accountUnavailable(): Response | null {
  const state = accountConfiguration();
  if (state === "disabled") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (state === "missing") {
    return Response.json({ error: "account_not_configured" }, { status: 503 });
  }
  return null;
}

export async function accountClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const cookie of cookiesToSet) {
              cookieStore.set(cookie.name, cookie.value, cookie.options);
            }
          } catch {
            // A Server Component cannot write cookies. The proxy route refreshes them.
          }
        },
      },
    },
  );
}

export function accountAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return null;
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function accountProfile() {
  const blocked = accountUnavailable();
  if (blocked) {
    return { blocked, supabase: null, profile: null };
  }
  const supabase = await accountClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) {
    return {
      blocked: Response.json({ error: "unauthenticated" }, { status: 401 }),
      supabase,
      profile: null,
    };
  }
  const profile = await supabase
    .from("profiles")
    .select("id, email, display_name, role, active, must_change_password")
    .eq("id", user.data.user.id)
    .maybeSingle();
  if (!profile.data?.active) {
    return {
      blocked: Response.json({ error: "inactive" }, { status: 403 }),
      supabase,
      profile: null,
    };
  }
  return { blocked: null, supabase, profile: profile.data };
}

const attempts = new Map<string, number[]>();

export function limitAccountAction(key: string, limit = 10): boolean {
  const now = Date.now();
  const hits = (attempts.get(key) ?? []).filter((stamp) => now - stamp < 60_000);
  if (hits.length >= limit) {
    attempts.set(key, hits);
    return false;
  }
  hits.push(now);
  attempts.set(key, hits);
  return true;
}
