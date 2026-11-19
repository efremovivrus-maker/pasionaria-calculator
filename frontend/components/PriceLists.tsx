"use client";

import { SyntheticEvent, useEffect, useMemo, useState } from "react";

type Column = { key: string; label: string };
type Table = { id: string; title: string; columns: Column[]; rows: Array<Record<string, unknown>> };
type Catalog = {
  catalog: string;
  title: string;
  version: string | null;
  version_date: string | null;
  note: string;
  tables: Table[];
};

const STORAGE_KEY = "pasionaria.price-list";

const TABS = [
  { id: "works", label: "Работы" },
  { id: "fabrics", label: "Ткани" },
  { id: "curtains", label: "Шторы" },
  { id: "bedspreads", label: "Покрывала" },
  { id: "trims", label: "Фурнитура" },
] as const;

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return String(value);
}

function storedView(): { catalogId: (typeof TABS)[number]["id"]; query: string; category: string } | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "") as {
      catalogId?: string;
      query?: string;
      category?: string;
    };
    const catalogId = TABS.find((tab) => tab.id === parsed.catalogId)?.id;
    if (!catalogId) {
      return null;
    }
    return {
      catalogId,
      query: typeof parsed.query === "string" ? parsed.query : "",
      category: typeof parsed.category === "string" ? parsed.category : "",
    };
  } catch {
    return null;
  }
}

export function PriceLists() {
  const [catalogId, setCatalogId] = useState<(typeof TABS)[number]["id"]>("works");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const stored = storedView();
    if (stored) {
      setCatalogId(stored.catalogId);
      setQuery(stored.query);
      setCategory(stored.category);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) {
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ catalogId, query, category }));
  }, [restored, catalogId, query, category]);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setMessage("");
    void fetch(`/api/account/price-lists?catalog=${catalogId}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(response.status === 503 ? "Справочник сейчас недоступен." : "Не удалось открыть прайс-лист.");
        }
        return (await response.json()) as Catalog;
      })
      .then((payload) => {
        if (!cancelled) {
          setCatalog(payload);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setMessage(error.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [catalogId]);

  const categories = useMemo(() => {
    const values = new Set<string>();
    for (const table of catalog?.tables ?? []) {
      for (const row of table.rows) {
        const value = row.category ?? row.group ?? row.category_source;
        if (typeof value === "string" && value) {
          values.add(value);
        }
      }
    }
    return [...values];
  }, [catalog]);

  function visibleRows(table: Table) {
    const needle = query.trim().toLocaleLowerCase("ru");
    return table.rows.filter((row) => {
      const group = String(row.category ?? row.group ?? row.category_source ?? "");
      if (category && group !== category) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return Object.values(row).some((value) => String(value ?? "").toLocaleLowerCase("ru").includes(needle));
    });
  }

  async function download(event: SyntheticEvent) {
    event.preventDefault();
    const response = await fetch(`/api/account/price-lists?catalog=${catalogId}&export=xlsx`);
    if (!response.ok) {
      setMessage("Не удалось скачать файл.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pasionaria-${catalogId}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-10 text-stone-900">
      <h1 className="text-3xl text-stone-950">Прайс-листы</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
        Показаны справочники, по которым считается калькулятор. Цены здесь только для просмотра.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setCatalogId(tab.id);
              setCategory("");
            }}
            className={`min-h-10 border px-3 text-sm ${catalogId === tab.id ? "border-stone-950 bg-stone-950 text-[#f7f4ec]" : "border-stone-300"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <form onSubmit={(event) => void download(event)} className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Поиск
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-1 block border border-stone-300 bg-transparent px-3 py-2"
            placeholder="Название или артикул"
          />
        </label>
        {categories.length > 1 ? (
          <label className="text-sm">
            Категория
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-1 block border border-stone-300 bg-transparent px-3 py-2"
            >
              <option value="">Все</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" onClick={(event) => void download(event)} className="min-h-10 border border-stone-950 px-3 text-sm">
          Скачать Excel
        </button>
      </form>
      {catalog?.version ? (
        <p className="mt-4 text-xs text-stone-500">
          Источник: {catalog.version}
          {catalog.version_date ? ` · ${catalog.version_date}` : ""}
        </p>
      ) : null}
      {catalog?.note ? <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-700">{catalog.note}</p> : null}
      {message ? <p className="mt-4 text-sm text-stone-800">{message}</p> : null}
      {catalog?.tables.map((table) => (
        <section key={table.id} className="mt-8 overflow-x-auto">
          {catalog.tables.length > 1 ? <h2 className="mb-3 text-lg">{table.title}</h2> : null}
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column.key} className="border-b border-stone-300 px-2 py-2 font-medium">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows(table).map((row, index) => (
                <tr key={`${table.id}-${index}`}>
                  {table.columns.map((column) => (
                    <td key={column.key} className="border-b border-stone-200 px-2 py-2 align-top">
                      {cell(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
