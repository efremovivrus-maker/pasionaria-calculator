"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { accountEnabledInBrowser } from "@/lib/account/rules";

const LINKS = [
  { href: "/", label: "Калькулятор" },
  { href: "/account/documents", label: "Мои КП" },
  { href: "/account/price-lists", label: "Прайс-листы" },
] as const;

export function SiteNav({ onCalculator }: { onCalculator?: () => void }) {
  const enabled = accountEnabledInBrowser();
  const path = usePathname();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void fetch("/api/account/session")
      .then((response) => setSignedIn(response.ok))
      .catch(() => setSignedIn(false));
  }, [enabled]);

  if (!enabled || !signedIn) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {LINKS.map((link) => {
        const active = link.href === "/" ? path === "/" : path.startsWith(link.href);
        const className = `inline-flex min-h-10 items-center px-2.5 text-xs ${
          active ? "bg-stone-950 text-[#f7f4ec]" : "text-stone-800 hover:bg-stone-200"
        }`;
        if (link.href === "/" && onCalculator && path === "/") {
          return (
            <button key={link.href} type="button" onClick={onCalculator} className={className}>
              {link.label}
            </button>
          );
        }
        return (
          <Link key={link.href} href={link.href} className={className}>
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
