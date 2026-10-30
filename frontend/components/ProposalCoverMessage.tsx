"use client";

import { useEffect, useState } from "react";

import { useProposal } from "@/components/ProposalProvider";
import {
  COVER_OFFER_GROUPS,
  coverDiscountReady,
  coverMessageInput,
  proposalContentFingerprint,
} from "@/lib/coverMessage";
import type { CoverOfferId, CoverTone } from "@/lib/proposal";

const fieldClass =
  "mt-2 w-full border border-stone-300 bg-transparent px-3 py-2 text-sm font-normal normal-case tracking-normal text-stone-950 outline-none focus:border-stone-800";

const TONES: Array<{ id: CoverTone; label: string }> = [
  { id: "warm", label: "Тёплый" },
  { id: "business", label: "Деловой" },
  { id: "brief", label: "Краткий" },
];

export function ProposalCoverMessage() {
  const { proposal, updateCover } = useProposal();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [failure, setFailure] = useState<"unavailable" | "discount" | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const cover = proposal.cover;
  const ready = coverDiscountReady(cover) && proposal.items.length > 0;
  const stale =
    cover.text.trim().length > 0 &&
    cover.sourceFingerprint !== proposalContentFingerprint(proposal);

  useEffect(() => {
    if (cover.text.trim()) {
      setOpen(true);
    }
  }, [cover.text]);

  function toggleOffer(id: CoverOfferId) {
    const offers = cover.offers.includes(id)
      ? cover.offers.filter((offer) => offer !== id)
      : [...cover.offers, id];
    updateCover({ offers });
  }

  async function generate() {
    setState("working");
    setFailure(null);
    setCopied(false);
    try {
      const response = await fetch("/api/proposal-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(coverMessageInput(proposal)),
      });
      const payload = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || typeof payload.text !== "string" || !payload.text.trim()) {
        setFailure(payload.error === "discount" ? "discount" : "unavailable");
        setState("failed");
        return;
      }
      updateCover({
        text: payload.text.trim(),
        sourceFingerprint: proposalContentFingerprint(proposal),
      });
      setState("idle");
    } catch {
      setFailure("unavailable");
      setState("failed");
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(cover.text);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="min-h-11 border border-stone-800 px-5 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-900 hover:text-stone-50"
      >
        Создать сопроводительное сообщение
      </button>
      {open ? (
        <section className="w-full border border-stone-300 px-4 py-5 sm:px-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
            Сопроводительное сообщение
          </h2>
          <div className="mt-5 grid gap-6">
            {COVER_OFFER_GROUPS.map((group) => (
              <fieldset key={group.title}>
                <legend className="text-sm font-medium text-stone-900">{group.title}</legend>
                <div className="mt-3 grid gap-2">
                  {group.options.map((option) => (
                    <label key={option.id} className="flex items-start gap-3 text-sm text-stone-800">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={cover.offers.includes(option.id)}
                        onChange={() => toggleOffer(option.id)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          {cover.offers.includes("discount") ? (
            <div className="mt-5 grid gap-4 border border-stone-200 px-4 py-4 sm:grid-cols-2">
              <fieldset>
                <legend className="text-xs text-stone-600">Размер скидки</legend>
                <div className="mt-2 flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-stone-800">
                    <input
                      type="radio"
                      name="cover-discount-kind"
                      value="percent"
                      checked={cover.discountKind === "percent"}
                      onChange={() => updateCover({ discountKind: "percent" })}
                    />
                    Процент
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-stone-800">
                    <input
                      type="radio"
                      name="cover-discount-kind"
                      value="fixed"
                      checked={cover.discountKind === "fixed"}
                      onChange={() => updateCover({ discountKind: "fixed" })}
                    />
                    Фиксированная сумма
                  </label>
                </div>
                <input
                  aria-label="Размер скидки"
                  inputMode="decimal"
                  value={cover.discountValue}
                  placeholder={cover.discountKind === "percent" ? "10" : "5000"}
                  onChange={(event) => updateCover({ discountValue: event.target.value })}
                  className={fieldClass}
                />
              </fieldset>
              <label className="block text-xs text-stone-600">
                Дата окончания предложения
                <input
                  aria-label="Дата окончания предложения"
                  type="date"
                  value={cover.discountUntil}
                  onChange={(event) => updateCover({ discountUntil: event.target.value })}
                  className={fieldClass}
                />
              </label>
              {!coverDiscountReady(cover) ? (
                <p className="text-sm text-stone-700 sm:col-span-2">
                  Укажите размер скидки, чтобы включить её в сообщение.
                </p>
              ) : null}
            </div>
          ) : null}
          <label className="mt-5 block text-xs text-stone-600">
            Пожелания к сообщению
            <textarea
              aria-label="Пожелания к сообщению"
              value={cover.notes}
              rows={3}
              onChange={(event) => updateCover({ notes: event.target.value })}
              className={fieldClass}
            />
          </label>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-stone-900">Тон сообщения</legend>
            <div className="mt-3 flex flex-wrap gap-4">
              {TONES.map((tone) => (
                <label key={tone.id} className="inline-flex items-center gap-2 text-sm text-stone-800">
                  <input
                    type="radio"
                    name="cover-tone"
                    value={tone.id}
                    checked={cover.tone === tone.id}
                    onChange={() => updateCover({ tone: tone.id })}
                  />
                  {tone.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-5">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!ready || state === "working"}
              className="min-h-11 bg-stone-950 px-5 text-sm font-semibold text-[#f7f4ec] transition-colors hover:bg-[#6d7565] disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {state === "working"
                ? "Сообщение готовится…"
                : cover.text
                  ? "Сгенерировать заново"
                  : "Сгенерировать сообщение"}
            </button>
          </div>
          {state === "failed" ? (
            <p role="alert" className="mt-3 text-sm text-stone-700">
              {failure === "discount"
                ? "Укажите размер скидки, чтобы включить её в сообщение."
                : "Не удалось создать сообщение. Сервис временно недоступен, попробуйте ещё раз."}
            </p>
          ) : null}
          {cover.text ? (
            <div className="mt-5">
              {stale ? (
                <p role="status" className="mb-3 text-sm text-stone-700">
                  Состав, цены или адресат коммерческого предложения изменились. Текст
                  сообщения может быть неактуальным.
                </p>
              ) : null}
              <label className="block text-xs text-stone-600">
                Текст сообщения
                <textarea
                  aria-label="Текст сообщения"
                  value={cover.text}
                  rows={10}
                  onChange={(event) => updateCover({ text: event.target.value })}
                  className={fieldClass}
                />
              </label>
              <button
                type="button"
                onClick={() => void copyMessage()}
                className="mt-3 min-h-11 border border-stone-800 px-5 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-900 hover:text-stone-50"
              >
                {copied ? "Сообщение скопировано" : "Копировать сообщение"}
              </button>
              {copyFailed ? (
                <p role="alert" className="mt-3 text-sm text-stone-700">
                  Не удалось скопировать сообщение.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
