"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { AccountFrame } from "@/components/AccountDocuments";

type CalculationRow = {
  id: string;
  raw_request: string;
  product_type: string | null;
  model: string | null;
  price: number | null;
  created_at: string;
};

export default function CalculationsPage() {
  const [rows, setRows] = useState<CalculationRow[]>([]);
  const [search, setSearch] = useState("");
  const [productType, setProductType] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback((event?: FormEvent) => {
    event?.preventDefault();
    const params = new URLSearchParams();
    if (search) {
      params.set("search", search);
    }
    if (productType) {
      params.set("productType", productType);
    }
    void fetch(`/api/account/calculations?${params.toString()}`)
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = "/account/login";
          return null;
        }
        return response.ok ? (response.json() as Promise<{ calculations: CalculationRow[] }>) : null;
      })
      .then((body) => setRows(body?.calculations ?? []))
      .catch(() => setMessage("История пока недоступна."));
  }, [productType, search]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
  }, []);

  async function repeat(id: string) {
    const response = await fetch(`/api/account/calculations/${id}/repeat`, { method: "POST" });
    if (!response.ok) {
      setMessage("Не удалось подготовить повтор.");
      return;
    }
    const body = (await response.json()) as { request: unknown };
    const calculated = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body.request),
    });
    setMessage(calculated.ok ? "Новый расчёт выполнен по актуальным тарифам. История не изменена." : "Повтор не выполнен.");
  }

  return (
    <AccountFrame title="Мои расчёты">
      <form onSubmit={load} className="mb-4 flex flex-wrap gap-2">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" className="border border-stone-300 px-3 py-2 text-sm" />
        <select value={productType} onChange={(event) => setProductType(event.target.value)} className="border border-stone-300 px-3 py-2 text-sm">
          <option value="">Все типы</option>
          <option value="curtain">Шторы</option>
          <option value="roman">Римские</option>
          <option value="bedspread">Покрывала</option>
        </select>
        <button type="submit" className="border border-stone-800 px-3 text-sm">Найти</button>
      </form>
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      <ul className="divide-y divide-stone-300 border-y border-stone-300">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div>
              <p>{row.raw_request}</p>
              <p className="text-xs text-stone-500">{row.created_at.slice(0, 10)} · {row.model} · {row.price ?? "—"} ₽</p>
            </div>
            <button type="button" className="underline" onClick={() => void repeat(row.id)}>Повторить расчёт</button>
          </li>
        ))}
      </ul>
    </AccountFrame>
  );
}
