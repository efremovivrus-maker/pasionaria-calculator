"use client";

import { useEffect, useState } from "react";

const PHRASES = [
  "Понимаю запрос…",
  "Проверяю модель…",
  "Рассчитываю расход ткани…",
  "Считаю стоимость…",
];

export function ThinkingState() {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPhraseIndex((current) => (current + 1) % PHRASES.length);
    }, 850);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div
      className="message-enter grid gap-3 py-6 sm:grid-cols-[112px_1fr]"
      aria-live="polite"
      aria-label={PHRASES[phraseIndex]}
    >
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-stone-500">
        Pasionaria
      </p>
      <div className="flex items-center gap-3 text-[1.02rem] text-stone-600">
        <span>{PHRASES[phraseIndex]}</span>
        <span className="flex gap-1" aria-hidden="true">
          <i className="thinking-dot" />
          <i className="thinking-dot [animation-delay:140ms]" />
          <i className="thinking-dot [animation-delay:280ms]" />
        </span>
      </div>
    </div>
  );
}
