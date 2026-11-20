"use client";

import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  EXAMPLE_LIBRARY,
  type CalculationExample,
  type ExampleCategory,
} from "@/lib/exampleLibrary";

type ExampleLibraryProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (example: CalculationExample) => void;
};

function focusable(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hasAttribute("disabled"));
}

export function ExampleLibrary({ open, onClose, onSelect }: ExampleLibraryProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const skipRestore = useRef(false);
  const [categoryId, setCategoryId] = useState<ExampleCategory["id"]>(EXAMPLE_LIBRARY[0].id);
  const category = EXAMPLE_LIBRARY.find((item) => item.id === categoryId) ?? EXAMPLE_LIBRARY[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    setCategoryId(EXAMPLE_LIBRARY[0].id);
    skipRestore.current = false;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }
      const items = focusable(dialogRef.current);
      if (items.length === 0) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (!skipRestore.current) {
        previous?.focus();
      }
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  function moveCategory(event: KeyboardEvent<HTMLDivElement>) {
    const current = EXAMPLE_LIBRARY.findIndex((item) => item.id === categoryId);
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? EXAMPLE_LIBRARY[current + 1]
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? EXAMPLE_LIBRARY[current - 1]
          : null;
    if (!next) {
      return;
    }
    event.preventDefault();
    setCategoryId(next.id);
    document.getElementById(`example-category-${next.id}`)?.focus();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-hidden bg-stone-950/35" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-full flex-col overflow-hidden bg-[#f7f4ec] sm:mx-auto sm:mt-10 sm:h-auto sm:max-h-[min(42rem,calc(100dvh-5rem))] sm:max-w-3xl sm:border sm:border-stone-300"
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-300 px-5 py-4">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#6d7565]">
              Библиотека
            </p>
            <h2 id={titleId} className="font-editorial text-2xl text-stone-950">
              Примеры расчётов
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-10 border border-stone-300 px-3 text-sm text-stone-800 hover:border-stone-800"
          >
            Закрыть
          </button>
        </div>
        <div
          role="tablist"
          aria-label="Категории примеров"
          onKeyDown={moveCategory}
          className="flex flex-wrap gap-2 border-b border-stone-300 px-5 py-3"
        >
          {EXAMPLE_LIBRARY.map((item) => {
            const selected = item.id === category.id;
            return (
              <button
                key={item.id}
                id={`example-category-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setCategoryId(item.id)}
                className={`min-h-10 px-3 text-left text-sm ${
                  selected ? "bg-stone-950 text-[#f7f4ec]" : "text-stone-700 hover:bg-stone-200"
                }`}
              >
                {item.title}
              </button>
            );
          })}
        </div>
        <div
          role="tabpanel"
          aria-label={category.title}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-2 sm:max-h-[min(32rem,calc(100dvh-13rem))] sm:flex-none"
        >
          <ul className="divide-y divide-stone-300">
            {category.examples.map((example) => (
              <li key={example.id}>
                <button
                  type="button"
                  onClick={() => {
                    skipRestore.current = true;
                    onSelect(example);
                  }}
                  className="block w-full max-w-full py-4 text-left hover:bg-stone-200/70"
                >
                  <span className="block text-sm font-medium text-stone-950">{example.title}</span>
                  <span className="mt-1 block break-words text-sm leading-6 text-stone-800">
                    {example.request}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-stone-500">{example.caption}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
