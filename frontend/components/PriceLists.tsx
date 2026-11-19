"use client";

import { Fragment, SyntheticEvent, useEffect, useMemo, useState } from "react";

type Column = { key: string; label: string; export_only?: boolean };
type DetailRow = { label: string; value: string };
type RowDetails = { groups: Array<{ title: string; rows: DetailRow[] }>; questions: string[] };
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
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value === "" ? "—" : String(value);
  }
  return "—";
}

function searchableText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(searchableText).join(" ");
  }
  if (value && typeof value === "object") {
    return Object.values(value).map(searchableText).join(" ");
  }
  return "";
}

function rowDetails(row: Record<string, unknown>): RowDetails | null {
  const details = row.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  const groups = (details as { groups?: unknown }).groups;
  const questions = (details as { questions?: unknown }).questions;
  if (!Array.isArray(groups)) {
    return null;
  }
  return {
    groups: groups.filter(
      (group): group is { title: string; rows: DetailRow[] } =>
        Boolean(group) &&
        typeof group === "object" &&
        typeof (group as { title?: unknown }).title === "string" &&
        Array.isArray((group as { rows?: unknown }).rows),
    ),
    questions: Array.isArray(questions) ? questions.filter((item): item is string => typeof item === "string") : [],
  };
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
  const [openRow, setOpenRow] = useState<string | null>(null);

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
      return searchableText(row).toLocaleLowerCase("ru").includes(needle);
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
              setOpenRow(null);
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
      {catalog?.tables.map((table) => {
        const shownColumns = table.columns.filter((column) => !column.export_only);
        const rows = visibleRows(table);
        const expandable = rows.some((row) => rowDetails(row));
        return (
        <section key={table.id} className="mt-8 overflow-x-auto">
          {catalog.tables.length > 1 ? <h2 className="mb-3 text-lg">{table.title}</h2> : null}
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {shownColumns.map((column) => (
                  <th key={column.key} className="border-b border-stone-300 px-2 py-2 font-medium">
                    {column.label}
                  </th>
                ))}
                {expandable ? (
                  <th className="border-b border-stone-300 px-2 py-2 font-medium">
                    <span className="sr-only">Подробности</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const rowKey = `${table.id}-${String(row.article ?? row.model ?? index)}`;
                const details = rowDetails(row);
                const open = openRow === rowKey;
                return (
                  <Fragment key={rowKey}>
                    <tr>
                      {shownColumns.map((column) => (
                        <td key={column.key} className="border-b border-stone-200 px-2 py-2 align-top">
                          {cell(row[column.key])}
                        </td>
                      ))}
                      {expandable ? (
                        <td className="border-b border-stone-200 px-2 py-2 align-top">
                          {details ? (
                            <button
                              type="button"
                            aria-expanded={open}
                            aria-label={open ? `Скрыть карточку ${row.model ?? ""}` : `Подробнее о ${row.model ?? ""}`}
                            onClick={() => setOpenRow(open ? null : rowKey)}
                              className="min-h-9 text-xs text-stone-800 underline"
                            >
                              {open ? "Скрыть" : "Подробнее"}
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                    {open && details ? (
                      <tr>
                        <td colSpan={shownColumns.length + 1} className="border-b border-stone-200 bg-[#f8f6f0] px-3 py-4">
                          <div className="grid gap-5 md:grid-cols-2">
                            {details.groups.map((group) => (
                              <section key={group.title}>
                                <h3 className="text-sm font-medium text-stone-950">{group.title}</h3>
                                <dl className="mt-2 space-y-1">
                                  {group.rows.map((item) => (
                                    <div key={item.label} className="grid gap-1 sm:grid-cols-[11rem_1fr]">
                                      <dt className="text-stone-500">{item.label}</dt>
                                      <dd>{item.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </section>
                            ))}
                          </div>
                          {details.questions.length > 0 ? (
                            <section className="mt-5">
                              <h3 className="text-sm font-medium text-stone-950">Открытые вопросы</h3>
                              <ul className="mt-2 list-disc space-y-1 pl-5">
                                {details.questions.map((question) => (
                                  <li key={question}>{question}</li>
                                ))}
                              </ul>
                            </section>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
        );
      })}
    </main>
  );
}
