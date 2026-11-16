"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { accountEnabledInBrowser } from "@/lib/account/rules";
import type { CalculationResponsePayload } from "@/lib/types";

export const ACCOUNT_LINK_KEY = "pasionaria.account-proposal-link.v1";
export const ACCOUNT_OPEN_KEY = "pasionaria.account-open";

let browser: SupabaseClient | null | undefined;

export function accountBrowser(): SupabaseClient | null {
  if (!accountEnabledInBrowser()) {
    return null;
  }
  if (browser !== undefined) {
    return browser;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  browser = url && key ? createBrowserClient(url, key) : null;
  return browser;
}

export function rememberCalculation(input: {
  kind: "result" | "unavailable" | "error";
  rawRequest: string;
  payload: CalculationResponsePayload;
  productType?: string;
  model?: string;
  price?: number;
}): void {
  if (!accountEnabledInBrowser()) {
    return;
  }
  const status = input.kind === "result" ? "success" : "failed";
  void fetch("/api/account/calculations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawRequest: input.rawRequest,
      normalizedInput:
        (input.payload.normalized_request as Record<string, unknown> | undefined) ??
        (input.payload.request as Record<string, unknown> | undefined) ??
        {},
      result: input.payload,
      productType: input.productType ?? null,
      model: input.model ?? null,
      price: input.price ?? null,
      status,
    }),
  }).catch(() => undefined);
}
