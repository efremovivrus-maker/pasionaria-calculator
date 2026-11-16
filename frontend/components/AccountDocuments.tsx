"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { ACCOUNT_LINK_KEY, ACCOUNT_OPEN_KEY } from "@/lib/account/browser";
import { PROPOSAL_STORAGE_KEY } from "@/lib/proposal";

type Row = {
  id: string;
  number?: string;
  title?: string;
  client_name?: string | null;
  total?: number;
  updated_at?: string;
  version?: number;
  snapshot?: { proposal?: unknown };
};

export function DocumentList({ archive = false }: { archive?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch(`/api/account/proposals?status=${archive ? "archived" : "active"}`)
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = "/account/login";
          return null;
        }
        if (!response.ok) {
          setMessage("Список пока недоступен.");
          return null;
        }
        return response.json() as Promise<{ proposals: Row[] }>;
      })
      .then((body) => {
        if (body) {
          setRows(body.proposals);
        }
      })
      .catch(() => setMessage("Список пока недоступен."));
  }, [archive]);

  async function openDocument(id: string) {
    const response = await fetch(`/api/account/proposals/${id}`);
    if (!response.ok) {
      setMessage("Не удалось открыть КП.");
      return;
    }
    const body = (await response.json()) as { proposal: Row };
    const proposal = body.proposal.snapshot?.proposal;
    if (!proposal || typeof body.proposal.version !== "number") {
      setMessage("Сохранённое КП повреждено.");
      return;
    }
    sessionStorage.setItem(PROPOSAL_STORAGE_KEY, JSON.stringify(proposal));
    sessionStorage.setItem(
      ACCOUNT_LINK_KEY,
      JSON.stringify({ id: body.proposal.id, version: body.proposal.version }),
    );
    sessionStorage.setItem(ACCOUNT_OPEN_KEY, "proposal");
    window.location.href = "/";
  }

  return (
    <AccountFrame title={archive ? "Архив" : "Мои КП"}>
      {message ? <p className="text-sm text-stone-700">{message}</p> : null}
      <ul className="divide-y divide-stone-300 border-y border-stone-300">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div>
              <p className="font-medium">{row.title || row.number}</p>
              <p className="text-xs text-stone-500">
                {row.client_name || "Без клиента"} · {row.updated_at?.slice(0, 10)} · {row.total ?? 0} ₽
              </p>
            </div>
            <div className="flex gap-3">
              <button type="button" className="underline" onClick={() => void openDocument(row.id)}>
                Открыть
              </button>
              <button
                type="button"
                className="underline"
                onClick={() => void fetch(`/api/account/proposals/${row.id}/copy`, { method: "POST" })}
              >
                Копия
              </button>
              {!archive ? (
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    void fetch(`/api/account/proposals/${row.id}/archive`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ version: row.version }),
                    }).then(() => setRows((current) => current.filter((item) => item.id !== row.id)))
                  }
                >
                  В архив
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && !message ? <p className="text-sm text-stone-600">Пока пусто.</p> : null}
    </AccountFrame>
  );
}

export function AccountFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10 text-stone-900">
      <Link href="/" className="text-xs text-stone-600 underline">
        ← К калькулятору
      </Link>
      <h1 className="mt-4 text-3xl">{title}</h1>
      <nav className="mt-4 flex gap-4 text-sm">
        <Link href="/account/documents" className="underline">Мои КП</Link>
        <Link href="/account/calculations" className="underline">Мои расчёты</Link>
        <Link href="/account/archive" className="underline">Архив</Link>
      </nav>
      <div className="mt-6">{children}</div>
    </main>
  );
}
