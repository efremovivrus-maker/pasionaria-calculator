"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { FeedbackPrompt } from "@/components/FeedbackPrompt";
import { Message } from "@/components/Message";
import { ResultCard } from "@/components/ResultCard";
import { ThinkingState } from "@/components/ThinkingState";
import {
  CalculationResponseError,
  sendChatMessage,
  warmUpBackend,
} from "@/lib/api";
import { createFeedbackContext } from "@/lib/feedback";
import type {
  CalculationResult,
  ChatMessage,
  FeedbackContext,
} from "@/lib/types";

const EXAMPLES = [
  "Две шторы Вандер 130 × 280",
  "Римская штора Вандер 165 × 180",
  "Комплект штор Фито 140 × 270",
];
const CALCULATION_ERROR_MESSAGE =
  "Не удалось выполнить расчёт. Попробуйте ещё раз.";

type CompletedCalculation = {
  result: CalculationResult;
  feedback: FeedbackContext;
};

type FailedAttempt = {
  rawRequest: string;
  feedback: FeedbackContext;
};

function createId() {
  return crypto.randomUUID();
}

export function CalculatorChat() {
  const [sessionId, setSessionId] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [completed, setCompleted] =
    useState<CompletedCalculation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failedAttempt, setFailedAttempt] =
    useState<FailedAttempt | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const hasConversation =
    messages.length > 0 || isLoading || completed !== null;

  useEffect(() => {
    setSessionId(createId());
    void warmUpBackend();
  }, []);

  useEffect(() => {
    if (hasConversation) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [completed, hasConversation, isLoading, messages]);

  async function submitMessage(message: string, appendUser = true) {
    const trimmed = message.trim();
    if (!trimmed || !sessionId || isLoading || completed) {
      return;
    }

    if (appendUser) {
      setMessages((current) => [
        ...current,
        { id: createId(), role: "user", content: trimmed },
      ]);
    }
    setInput("");
    setFailedAttempt(null);
    setIsLoading(true);

    try {
      const response = await sendChatMessage(sessionId, trimmed);
      if (response.type === "clarification") {
        setMessages((current) => [
          ...current,
          {
            id: createId(),
            role: "assistant",
            content: response.question,
          },
        ]);
      } else if (response.type === "unavailable") {
        setMessages((current) => [
          ...current,
          {
            id: createId(),
            role: "assistant",
            content: response.message,
            feedback: createFeedbackContext(
              trimmed,
              response.payload,
            ),
          },
        ]);
      } else {
        setCompleted({
          result: response.result,
          feedback: createFeedbackContext(trimmed, response.payload),
        });
      }
    } catch (error) {
      const errorResult =
        error instanceof CalculationResponseError && error.payload
          ? error.payload
          : {
              status: "error",
              message: CALCULATION_ERROR_MESSAGE,
            };
      setFailedAttempt({
        rawRequest: trimmed,
        feedback: createFeedbackContext(trimmed, errorResult),
      });
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage(input);
    }
  }

  function resetCalculation() {
    setSessionId(createId());
    setInput("");
    setMessages([]);
    setCompleted(null);
    setFailedAttempt(null);
    setIsLoading(false);
  }

  return (
    <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col px-5 pb-10 pt-12 sm:px-8 sm:pt-20 lg:px-10">
      <header
        className={`max-w-3xl transition-all duration-300 ${
          hasConversation ? "mb-8 sm:mb-11" : "mb-10 sm:mb-14"
        }`}
      >
        <p className="mb-5 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[#6d7565]">
          Индивидуальный расчёт
        </p>
        <h1
          className={`font-editorial text-stone-950 transition-all duration-300 ${
            hasConversation
              ? "text-[2.5rem] leading-[1.02] sm:text-[3.2rem]"
              : "text-[3rem] leading-[0.98] sm:text-[4.8rem]"
          }`}
        >
          Рассчитайте стоимость штор
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-stone-600 sm:text-lg">
          Опишите, что вам нужно. Например: две шторы Вандер 130 × 280 см.
        </p>
      </header>

      {!hasConversation ? (
        <section className="initial-enter">
          <form onSubmit={handleSubmit}>
            <label htmlFor="initial-request" className="sr-only">
              Опишите изделие
            </label>
            <div className="border-y border-stone-300 bg-[#f8f6f0] px-5 py-5 sm:px-7 sm:py-7">
              <textarea
                id="initial-request"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Например: римская штора Вандер 165 × 180 см"
                rows={3}
                autoFocus
                className="w-full resize-none bg-transparent text-lg leading-8 text-stone-950 outline-none placeholder:text-stone-400 sm:text-xl"
              />
              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={!input.trim() || !sessionId || isLoading}
                  className="min-h-12 w-full bg-stone-950 px-7 text-sm font-semibold text-[#f7f4ec] transition-colors duration-200 hover:bg-[#6d7565] disabled:cursor-not-allowed disabled:bg-stone-300 sm:w-auto"
                >
                  Рассчитать
                </button>
              </div>
            </div>
          </form>

          <div className="mt-5 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setInput(example)}
                className="min-h-10 border border-stone-300 px-4 text-left text-xs leading-5 text-stone-600 transition-colors duration-200 hover:border-stone-500 hover:text-stone-950"
              >
                {example}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="min-h-0">
          <div className="border-t border-stone-300">
            {messages.map((message) => (
              <div key={message.id}>
                <Message message={message} />
                {message.feedback && (
                  <FeedbackPrompt context={message.feedback} />
                )}
              </div>
            ))}
            {isLoading && <ThinkingState />}
          </div>

          {failedAttempt && !isLoading && (
            <div className="message-enter mt-4">
              <div
                className="flex flex-col items-start justify-between gap-4 border-y border-stone-300 py-5 sm:flex-row sm:items-center"
                role="alert"
              >
                <p className="text-sm text-stone-700">
                  {CALCULATION_ERROR_MESSAGE}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void submitMessage(failedAttempt.rawRequest, false)
                  }
                  className="min-h-10 border border-stone-700 px-5 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-900 hover:text-stone-50"
                >
                  Повторить
                </button>
              </div>
              <FeedbackPrompt context={failedAttempt.feedback} />
            </div>
          )}

          {completed ? (
            <>
              <ResultCard
                result={completed.result}
                onReset={resetCalculation}
              />
              <FeedbackPrompt context={completed.feedback} />
            </>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="mt-7 border-b border-stone-400 pb-3"
            >
              <label htmlFor="chat-request" className="sr-only">
                Следующее сообщение
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <textarea
                  id="chat-request"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Напишите ответ или уточните параметры"
                  rows={2}
                  disabled={isLoading}
                  className="min-h-14 flex-1 resize-none bg-transparent py-2 text-base leading-6 text-stone-950 outline-none placeholder:text-stone-400 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading || !sessionId}
                  className="min-h-11 w-full bg-stone-950 px-6 text-sm font-semibold text-[#f7f4ec] transition-colors duration-200 hover:bg-[#6d7565] disabled:cursor-not-allowed disabled:bg-stone-300 sm:w-auto"
                >
                  Отправить
                </button>
              </div>
            </form>
          )}
          <div ref={endRef} />
        </section>
      )}
    </main>
  );
}
