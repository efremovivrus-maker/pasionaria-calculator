"use client";

import { FormEvent, useId, useRef, useState } from "react";

import {
  sendCalculationFeedback,
  type FeedbackValue,
} from "@/lib/feedback";
import type { FeedbackContext } from "@/lib/types";

type FeedbackPromptProps = {
  context: FeedbackContext;
};

const NEGATIVE_OPTIONS: Array<{
  value: Exclude<FeedbackValue, "positive">;
  label: string;
}> = [
  { value: "incorrect_price", label: "Неверная стоимость" },
  { value: "incorrect_model", label: "Неверно определена модель" },
  {
    value: "incorrect_configuration",
    label: "Неверная комплектация",
  },
  {
    value: "calculation_failed",
    label: "Не удалось выполнить расчёт",
  },
  { value: "other", label: "Другое" },
];

export function FeedbackPrompt({ context }: FeedbackPromptProps) {
  const dialogTitleId = useId();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selected, setSelected] =
    useState<Exclude<FeedbackValue, "positive"> | null>(null);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const sentRef = useRef(false);

  async function submitFeedback(
    feedback: FeedbackValue,
    feedbackComment: string,
  ) {
    if (inFlightRef.current || sentRef.current) {
      return;
    }

    inFlightRef.current = true;
    setStatus("loading");
    setError(null);
    try {
      await sendCalculationFeedback(
        context,
        feedback,
        feedbackComment,
      );
      sentRef.current = true;
      setStatus("sent");
      setIsDialogOpen(false);
    } catch {
      setStatus("idle");
      setError("Не удалось отправить. Попробуйте ещё раз.");
    } finally {
      inFlightRef.current = false;
    }
  }

  function handleNegativeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected) {
      void submitFeedback(selected, comment);
    }
  }

  if (status === "sent") {
    return (
      <p
        className="mt-3 border-t border-stone-300/60 pt-3 text-xs text-stone-500"
        role="status"
      >
        Спасибо за обратную связь
      </p>
    );
  }

  return (
    <section className="mt-3 border-t border-stone-300/60 pt-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-xs text-stone-500">Результат был полезен?</p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={status === "loading"}
            onClick={() => void submitFeedback("positive", "")}
            className="min-h-8 border border-stone-300 px-3 text-xs text-stone-600 transition-colors hover:border-stone-500 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "loading" && !isDialogOpen
              ? "Отправляем…"
              : "👍 Всё верно"}
          </button>
          <button
            type="button"
            disabled={status === "loading"}
            onClick={() => {
              setError(null);
              setIsDialogOpen(true);
            }}
            className="min-h-8 border border-stone-300 px-3 text-xs text-stone-600 transition-colors hover:border-stone-500 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            👎 Есть проблема
          </button>
        </div>
      </div>

      {isDialogOpen && (
        <div
          role="dialog"
          aria-labelledby={dialogTitleId}
          className="mt-3 max-w-lg border border-stone-300 bg-[#f8f6f0] p-4 sm:p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <h2
              id={dialogTitleId}
              className="text-sm font-medium text-stone-950"
            >
              Что пошло не так?
            </h2>
            <button
              type="button"
              aria-label="Закрыть"
              disabled={status === "loading"}
              onClick={() => setIsDialogOpen(false)}
              className="text-lg leading-none text-stone-400 hover:text-stone-800 disabled:opacity-50"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleNegativeSubmit} className="mt-4">
            <fieldset className="space-y-2">
              <legend className="sr-only">Причина проблемы</legend>
              {NEGATIVE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-3 text-xs text-stone-700"
                >
                  <input
                    type="radio"
                    name="feedback-reason"
                    value={option.value}
                    checked={selected === option.value}
                    onChange={() => setSelected(option.value)}
                    className="accent-stone-900"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            <label className="mt-4 block text-xs text-stone-600">
              Комментарий
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                placeholder="Комментарий"
                disabled={status === "loading"}
                className="mt-2 w-full resize-y border border-stone-300 bg-white/60 px-3 py-2 text-sm leading-5 text-stone-900 outline-none placeholder:text-stone-400 focus:border-stone-500 disabled:opacity-60"
              />
            </label>

            <button
              type="submit"
              disabled={!selected || status === "loading"}
              className="mt-4 min-h-9 bg-stone-900 px-4 text-xs font-medium text-stone-50 transition-colors hover:bg-[#6d7565] disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {status === "loading" ? "Отправляем…" : "Отправить"}
            </button>
          </form>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
