import "server-only";

import {
  CoverMessageError,
  composeCoverMessage,
  coverPrompt,
  mergeDraftWithFallbacks,
  messageViolatesSpec,
  missingOfferIds,
  parseCoverMessageDraft,
  parseCoverMessageInput,
  repairPromptMissingIds,
} from "@/lib/coverMessage";
import { selectedOfferInstructions } from "@/lib/coverMessageOffers";

const COMPLETION_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion";
export async function generateCoverMessage(value: unknown): Promise<string> {
  const input = parseCoverMessageInput(value);
  if (input.offers.includes("discount") && !input.discount) {
    throw new CoverMessageError("invalid_discount");
  }
  const instructions = selectedOfferInstructions(input);
  const prompt = coverPrompt(input);
  let user = prompt.user;
  let draft = readDraft(await completeYandexGpt(prompt.system, user));
  let missing = missingOfferIds(draft, input.offers);

  if (missing.length > 0) {
    user = `${prompt.user}\n\n${repairPromptMissingIds(missing)}`;
    draft = readDraft(await completeYandexGpt(prompt.system, user));
    missing = missingOfferIds(draft, input.offers);
  }

  if (missing.length > 0) {
    draft = mergeDraftWithFallbacks(draft, missing, instructions);
  }

  let text = composeCoverMessage(draft);
  if (messageViolatesSpec(text, input)) {
    user = `${prompt.user}\n\nНе перечисляй изделия, размеры, ткани и цены позиций. Только общая сумма total. Верни JSON заново.`;
    draft = readDraft(await completeYandexGpt(prompt.system, user));
    missing = missingOfferIds(draft, input.offers);
    if (missing.length > 0) {
      draft = mergeDraftWithFallbacks(draft, missing, instructions);
    }
    text = composeCoverMessage(draft);
  }

  if (!text.trim()) {
    throw new CoverMessageError("unavailable");
  }
  return text.trim();
}

async function completeYandexGpt(system: string, user: string): Promise<string> {
  const apiKey = process.env.YANDEX_GPT_API_KEY?.trim() ?? "";
  const folderId = process.env.YANDEX_GPT_FOLDER_ID?.trim() ?? "";
  if (!apiKey || !/^[\w-]{1,80}$/.test(folderId)) {
    throw new CoverMessageError("unavailable");
  }
  let response: Response;
  try {
    response = await fetch(COMPLETION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Api-Key ${apiKey}`,
        "x-folder-id": folderId,
      },
      body: JSON.stringify({
        modelUri: `gpt://${folderId}/yandexgpt/latest`,
        completionOptions: {
          stream: false,
          temperature: 0.35,
          maxTokens: "1200",
        },
        messages: [
          { role: "system", text: system },
          { role: "user", text: user },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new CoverMessageError("unavailable");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new CoverMessageError("unavailable");
  }
  let payload: {
    result?: { alternatives?: Array<{ message?: { text?: string } }> };
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new CoverMessageError("unavailable");
  }
  const text = payload.result?.alternatives?.[0]?.message?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new CoverMessageError("unavailable");
  }
  return text;
}

function readDraft(raw: string) {
  try {
    return parseCoverMessageDraft(raw);
  } catch {
    throw new CoverMessageError("unavailable");
  }
}
