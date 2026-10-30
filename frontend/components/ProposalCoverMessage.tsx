"use client";

import { useEffect, useState } from "react";

import { useProposal } from "@/components/ProposalProvider";
import { coverMessageInput, proposalContentFingerprint } from "@/lib/coverMessage";
import { COVER_OFFER_GROUPS } from "@/lib/coverMessageCatalog";
import {
  computeProposalTotals,
  proposalDiscountValid,
  type CoverOfferId,
  type CoverTone,
} from "@/lib/proposal";

const fieldClass =
  "mt-1.5 w-full border border-stone-300 bg-transparent px-3 py-2 text-sm font-normal normal-case tracking-normal text-stone-950 outline-none focus:border-stone-800";

const TONES: Array<{ id: CoverTone; label: string }> = [
  { id: "warm", label: "Тёплый" },
  { id: "business", label: "Деловой" },
  { id: "brief", label: "Краткий" },
];

type ProposalCoverMessageProps = {
  open: boolean;
};

export function ProposalCoverMessage({ open }: ProposalCoverMessageProps) {
  const { proposal, updateCover } = useProposal();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [failure, setFailure] = useState<"unavailable" | "discount" | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showOfferSettings, setShowOfferSettings] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const cover = proposal.cover;
  const totals = computeProposalTotals(proposal);
  const ready =
    proposal.items.length > 0 &&
    proposalDiscountValid(proposal.discount, totals.subtotal);
  const stale =
    cover.text.trim().length > 0 &&
    cover.sourceFingerprint !== proposalContentFingerprint(proposal);
  const hasGeneratedText = cover.text.trim().length > 0;

  useEffect(() => {
    if (!hasGeneratedText) {
      setShowOfferSettings(true);
    }
  }, [hasGeneratedText]);

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
      setShowOfferSettings(false);
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

  if (!open) {
    return null;
  }

  return (
    <section
      aria-label="Сопроводительное сообщение"
      className="disclosure-panel mt-4 border border-stone-300 bg-[#faf8f3] px-4 py-4 sm:px-5"
    >
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
        Сопроводительное сообщение
      </h2>

      {hasGeneratedText ? (
        <div className="mt-4 space-y-4">
          {stale ? (
            <p role="status" className="text-sm text-stone-700">
              Состав, цены, скидка или адресат коммерческого предложения изменились. Текст
              сообщения может быть неактуальным.
            </p>
          ) : null}
          <label className="block text-xs text-stone-600">
            Текст сообщения
            <textarea
              aria-label="Текст сообщения"
              value={cover.text}
              rows={8}
              onChange={(event) => updateCover({ text: event.target.value })}
              className={fieldClass}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyMessage()}
              className="min-h-10 border border-stone-800 px-4 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-900 hover:text-stone-50"
            >
              {copied ? "Скопировано" : "Копировать"}
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!ready || state === "working"}
              className="min-h-10 border border-stone-300 px-4 text-sm text-stone-800 transition-colors hover:border-stone-800 disabled:cursor-not-allowed disabled:text-stone-400"
            >
              {state === "working" ? "Готовится…" : "Сгенерировать заново"}
            </button>
          </div>
          {copyFailed ? (
            <p role="alert" className="text-sm text-stone-700">
              Не удалось скопировать сообщение.
            </p>
          ) : null}
          {state === "failed" ? (
            <p role="alert" className="text-sm text-stone-700">
              {failure === "discount"
                ? "Проверьте настройки скидки в коммерческом предложении."
                : "Не удалось создать сообщение. Сервис временно недоступен, попробуйте ещё раз."}
            </p>
          ) : null}
          {showOfferSettings ? (
            <OfferSettings
              cover={cover}
              onToggleOffer={toggleOffer}
              tone={cover.tone}
              onTone={(tone) => updateCover({ tone })}
              notes={cover.notes}
              onNotes={(notes) => updateCover({ notes: notes })}
              advancedOpen={advancedOpen}
              onAdvancedToggle={() => setAdvancedOpen((current) => !current)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowOfferSettings(true)}
              className="text-sm text-stone-700 underline decoration-stone-300 underline-offset-2 hover:text-stone-950"
            >
              Изменить предложения
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <OfferSettings
            cover={cover}
            onToggleOffer={toggleOffer}
            tone={cover.tone}
            onTone={(tone) => updateCover({ tone })}
            notes={cover.notes}
            onNotes={(notes) => updateCover({ notes: notes })}
            advancedOpen={advancedOpen}
            onAdvancedToggle={() => setAdvancedOpen((current) => !current)}
          />
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!ready || state === "working"}
            className="min-h-11 w-full bg-stone-950 px-5 text-sm font-semibold text-[#f7f4ec] transition-colors hover:bg-[#6d7565] disabled:cursor-not-allowed disabled:bg-stone-300 sm:w-auto"
          >
            {state === "working" ? "Сообщение готовится…" : "Сгенерировать сообщение"}
          </button>
          {state === "failed" ? (
            <p role="alert" className="text-sm text-stone-700">
              {failure === "discount"
                ? "Проверьте настройки скидки в коммерческом предложении."
                : "Не удалось создать сообщение. Сервис временно недоступен, попробуйте ещё раз."}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function OfferSettings({
  cover,
  onToggleOffer,
  tone,
  onTone,
  notes,
  onNotes,
  advancedOpen,
  onAdvancedToggle,
}: {
  cover: { offers: CoverOfferId[]; notes: string };
  onToggleOffer: (id: CoverOfferId) => void;
  tone: CoverTone;
  onTone: (tone: CoverTone) => void;
  notes: string;
  onNotes: (notes: string) => void;
  advancedOpen: boolean;
  onAdvancedToggle: () => void;
}) {
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        {COVER_OFFER_GROUPS.map((group) => (
          <fieldset key={group.title}>
            <legend className="text-sm font-medium text-stone-900">{group.title}</legend>
            <div className="mt-2 grid gap-1.5">
              {group.options.map((option) => (
                <label
                  key={option.id}
                  className="flex items-start gap-2.5 text-sm text-stone-800"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    aria-label={option.label}
                    checked={cover.offers.includes(option.id)}
                    onChange={() => onToggleOffer(option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div role="group" aria-label="Тон сообщения" className="flex flex-wrap gap-1">
        {TONES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={tone === entry.id}
            onClick={() => onTone(entry.id)}
            className={`min-h-9 border px-3 text-sm transition-colors ${
              tone === entry.id
                ? "border-stone-800 bg-stone-900 text-[#f7f4ec]"
                : "border-stone-300 text-stone-800 hover:border-stone-600"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div>
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={onAdvancedToggle}
          className="text-sm text-stone-700 underline decoration-stone-300 underline-offset-2 hover:text-stone-950"
        >
          Дополнительные настройки
        </button>
        {advancedOpen ? (
          <label className="mt-2 block text-xs text-stone-600">
            Пожелания к сообщению
            <textarea
              aria-label="Пожелания к сообщению"
              value={notes}
              rows={2}
              onChange={(event) => onNotes(event.target.value)}
              className={fieldClass}
            />
          </label>
        ) : null}
      </div>
    </>
  );
}
