"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { accountBrowser } from "@/lib/account/browser";
import { accountEnabledInBrowser } from "@/lib/account/rules";

type Profile = { email?: string; role?: string; display_name?: string };

export function AccountMenu() {
  const enabled = accountEnabledInBrowser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void fetch("/api/account/session")
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body: { profile?: Profile } | null) => setProfile(body?.profile ?? null))
      .catch(() => setProfile(null));
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  async function signOut() {
    await accountBrowser()?.auth.signOut();
    setProfile(null);
    setOpen(false);
  }

  if (!profile) {
    return (
      <Link
        href="/account/login"
        className="inline-flex min-h-10 items-center border border-stone-300 px-2.5 text-xs text-stone-800 hover:border-stone-800"
      >
        Войти
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-10 items-center border border-stone-300 px-2.5 text-xs text-stone-800 hover:border-stone-800"
        aria-expanded={open}
      >
        {profile.display_name || profile.email || "Профиль"}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-48 border border-stone-300 bg-[#f8f6f0] p-2 text-sm">
          <Link href="/account/documents" className="block px-2 py-1.5 hover:bg-stone-200" onClick={() => setOpen(false)}>
            Мои документы
          </Link>
          <Link href="/account/price-lists" className="block px-2 py-1.5 hover:bg-stone-200" onClick={() => setOpen(false)}>
            Прайс-листы
          </Link>
          <Link href="/account/password" className="block px-2 py-1.5 hover:bg-stone-200" onClick={() => setOpen(false)}>
            Сменить пароль
          </Link>
          {profile.role === "admin" ? (
            <Link href="/account/admin" className="block px-2 py-1.5 hover:bg-stone-200" onClick={() => setOpen(false)}>
              Пользователи
            </Link>
          ) : null}
          <button type="button" onClick={() => void signOut()} className="block w-full px-2 py-1.5 text-left hover:bg-stone-200">
            Выйти
          </button>
        </div>
      ) : null}
    </div>
  );
}
