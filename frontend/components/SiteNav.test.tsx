import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteNav } from "@/components/SiteNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/account/price-lists",
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_ACCOUNT_ENABLED;
});

describe("site navigation", () => {
  it("shows calculator, proposals and price lists for a signed-in user", async () => {
    process.env.NEXT_PUBLIC_ACCOUNT_ENABLED = "true";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ profile: { role: "manager" } }), { status: 200 })),
    );
    render(<SiteNav />);
    expect(await screen.findByRole("link", { name: "Калькулятор" })).toHaveProperty("href", expect.stringContaining("/"));
    expect(screen.getByRole("link", { name: "Мои КП" }).getAttribute("href")).toBe("/account/documents");
    expect(screen.getByRole("link", { name: "Прайс-листы" }).getAttribute("href")).toBe("/account/price-lists");
  });

  it("hides account sections from a guest", async () => {
    process.env.NEXT_PUBLIC_ACCOUNT_ENABLED = "true";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    render(<SiteNav />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Прайс-листы" })).toBeNull();
  });
});
