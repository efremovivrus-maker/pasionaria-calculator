"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { AccountMenu } from "@/components/AccountMenu";
import { SiteNav } from "@/components/SiteNav";
import { accountBrowser } from "@/lib/account/browser";

export default function AccountLayout({ children }: { children: ReactNode }) {
  const path = usePathname();

  useEffect(() => {
    if (path === "/account/login") {
      return;
    }
    void fetch("/api/account/session").then(async (response) => {
      if (response.status === 401) {
        if (path !== "/account/password") {
          window.location.href = "/account/login";
        }
        return;
      }
      if (response.status === 403) {
        const body = (await response.json()) as { error?: string };
        if (body.error === "inactive") {
          await accountBrowser()?.auth.signOut();
          window.location.href = "/account/login";
        }
        return;
      }
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { profile?: { must_change_password?: boolean } };
      if (body.profile?.must_change_password && path !== "/account/password") {
        window.location.href = "/account/password";
      }
    });
  }, [path]);

  if (path === "/account/login") {
    return children;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-stone-300/90 bg-[#f4f1e9]/95">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-3">
          <Link href="/" className="text-sm font-bold tracking-[0.24em] text-stone-950">
            PASIONARIA
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SiteNav />
            <AccountMenu />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
