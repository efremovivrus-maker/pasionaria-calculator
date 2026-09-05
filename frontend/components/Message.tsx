import type { ChatMessage } from "@/lib/types";

type MessageProps = {
  message: ChatMessage;
};

export function Message({ message }: MessageProps) {
  const isUser = message.role === "user";

  return (
    <article
      className={`message-enter grid gap-3 py-6 sm:grid-cols-[112px_1fr] ${
        isUser ? "border-b border-stone-300/70" : ""
      }`}
    >
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-stone-500">
        {isUser ? "Вы" : "Pasionaria"}
      </p>
      <p
        className={`max-w-2xl whitespace-pre-wrap text-[1.02rem] leading-7 ${
          isUser ? "text-stone-700" : "text-stone-950"
        }`}
      >
        {message.content}
      </p>
    </article>
  );
}
