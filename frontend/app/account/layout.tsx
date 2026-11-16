"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

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

  return children;
}
