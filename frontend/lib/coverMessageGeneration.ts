import { formatProposalDate, formatProposalMoney } from "@/lib/proposalDocument";
import { clientLineAmount, roundMoney } from "@/lib/proposal";
import type { CoverOfferId, CoverTone } from "@/lib/proposal";
import type { CoverMessageDraft, CoverMessageInput } from "@/lib/coverMessageTypes";
import {
  categoryLabel,
  includedServiceTitles,
  productKind,
  projectTextileGaps,
  relationshipHints,
  roomFacts,
  selectedOfferInstructions,
} from "@/lib/coverMessageOffers";
import { COVER_OFFER_LABELS } from "@/lib/coverMessageCatalog";

const BASE_RULES = `Ты помощник менеджера PASIONARIA. Клиент уже получит PDF с позициями — не пересказывай спецификацию.

Ответь ТОЛЬКО валидным JSON без markdown и комментариев:
{
  "introduction": "обращение и факт отправки КП",
  "project_summary": "кратко объект, помещения, характер проекта и ОДНА общая стоимость из total",
  "included_services": "услуги уже в КП или пустая строка",
  "selected_offers": [{"id":"<id из managerSelectedOffers>","text":"естественная фраза"}],
  "closing": "приглашение обсудить и подпись"
}

Запрещено в любом поле:
- перечислять изделия с размерами, тканями, количеством и ценой за единицу;
- повторять более одной суммы (только общая стоимость КП из total);
- придумывать цены, сроки, наличие, условия акций;
- добавлять предложения, которых нет в managerSelectedOffers;
- пропускать ни одного id из managerSelectedOffers — каждый обязателен в selected_offers с тем же id;
- утверждать, что дополнительный расчёт уже включён в сумму КП.

included_services: перечисли только услуги из includedServicesInProposal (доставка, монтаж и т.д.), если они есть.
selected_offers: только выбранные менеджером пункты; следуй instruction для каждого id; можно объединять близкие в одной фразе, но каждый id — отдельный элемент массива.
relationshipHints и textileGaps — только контекст для формулировки УЖЕ выбранных id. Не упоминай категории, которых нет в managerSelectedOffers.
Не используй emoji и markdown.

Вступление (introduction): каждый раз разное по формулировке. Запрещено начинать с «Подготовили коммерческое предложение» и близких клише («направляем КП», «высылаем коммерческое предложение» в начале каждого текста).`;

const TONE_RULES: Record<CoverTone, string> = {
  warm: `Стиль «тёплый» — личное сообщение менеджера, который помогает оформить дом текстилем.
Пиши от лица команды («мы»), с заботой о комфорте и гармонии интерьера, без официоза.
Мягкие связки к допродажам: «будем рады», «можем аккуратно подобрать», «если захотите дополнить».
Примеры начала introduction (выбери один, не копируй дословно): «Анна, добрый день! Собрали для вас текстиль по объекту…»; «Здравствуйте, Анна! Завершили расчёт текстиля для…»; «Анна, делимся расчётом по вашей квартире…».
Объём всего сообщения: ориентир 75–120 слов.`,
  business: `Стиль «деловой» — профессиональное коммерческое сопровождение, не переписка «между знакомыми».
Нейтрально-уважительный тон, без эмоциональных эпитетов и бытовых оборотов. Без «будем рады» и «если захотите».
Структура сухая: факт КП → объект и зоны → сумма → дополнения → контакт.
Примеры начала introduction: «Анна, добрый день. Коммерческое предложение по текстилю для объекта…»; «Уважаемая Анна, направляем расчёт по текстильному оснащению…»; «Анна, по вашему запросу сформирован расчёт…».
Объём: 55–95 слов.`,
  brief: `Стиль «краткий» — сообщение в мессенджере, 2–4 предложения на ВСЁ поле (все части JSON вместе).
Без развёрнутого приветствия и длинного closing. Одна мысль — одно короткое предложение.
Примеры: «Анна, расчёт по квартире — 8 800 ₽. …»; «КП по спальне готово, итого …».
Не больше 60 слов суммарно.`,
};

export function coverPrompt(input: CoverMessageInput): { system: string; user: string } {
  return {
    system: `${BASE_RULES}\n\n${TONE_RULES[input.tone]}`,
    user: JSON.stringify(coverMessageBriefForModel(input)),
  };
}

export function coverMessageBriefForModel(input: CoverMessageInput): Record<string, unknown> {
  const step = input.proposal.roundingStep;
  const mode = input.proposal.roundingMode;
  const total = roundMoney(
    input.proposal.items.reduce((sum, item) => sum + clientLineAmount(item, step, mode), 0),
  );
  const rooms = roomFacts(input).map((room) => ({
    name: room.name,
    categories: [...room.kinds].map((kind) => categoryLabel(kind)),
  }));
  const managerSelectedOffers = selectedOfferInstructions(input).map((entry) => ({
    id: entry.id,
    label: COVER_OFFER_LABELS[entry.id],
    instruction: entry.instruction,
  }));
  return {
    tone: input.tone,
    recipient: input.proposal.recipient,
    author: input.proposal.author,
    objectName: input.proposal.objectName,
    issuedOn: formatProposalDate(input.proposal.issuedOn),
    total: formatProposalMoney(total),
    roomsOverview: rooms,
    includedServicesInProposal: includedServiceTitles(input),
    managerSelectedOffers,
    requiredOfferIds: input.offers,
    textileGaps: projectTextileGaps(input),
    relationshipHints: relationshipHints(input),
    discount: input.discount
      ? {
          size:
            input.discount.kind === "percent"
              ? `${input.discount.value}%`
              : formatProposalMoney(input.discount.value),
          until: formatProposalDate(input.discount.until),
        }
      : null,
    managerNotes: input.notes || null,
  };
}

export function parseCoverMessageDraft(raw: string): CoverMessageDraft {
  const json = extractJsonObject(raw);
  const source = JSON.parse(json) as Record<string, unknown>;
  return {
    introduction: textField(source.introduction),
    project_summary: textField(source.project_summary),
    included_services: textField(source.included_services),
    selected_offers: parseSelectedOffers(source.selected_offers),
    closing: textField(source.closing),
  };
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  throw new Error("invalid_json");
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseSelectedOffers(value: unknown): CoverMessageDraft["selected_offers"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.text !== "string") {
      return [];
    }
    const text = row.text.trim();
    return text ? [{ id: row.id.trim(), text }] : [];
  });
}

export function missingOfferIds(draft: CoverMessageDraft, required: CoverOfferId[]): CoverOfferId[] {
  const present = new Set(draft.selected_offers.map((entry) => entry.id));
  return required.filter((id) => !present.has(id));
}

export function mergeDraftWithFallbacks(
  draft: CoverMessageDraft,
  missing: CoverOfferId[],
  instructions: Array<{ id: CoverOfferId; instruction: string }>,
): CoverMessageDraft {
  if (missing.length === 0) {
    return draft;
  }
  const byId = new Map(instructions.map((entry) => [entry.id, entry.instruction]));
  const additions = missing.map((id) => ({
    id,
    text: fallbackOfferText(id, byId.get(id) ?? ""),
  }));
  return {
    ...draft,
    selected_offers: [...draft.selected_offers, ...additions],
  };
}

export function fallbackOfferText(id: CoverOfferId, instruction: string): string {
  const short = instruction.split(".")[0]?.trim();
  const templates: Partial<Record<CoverOfferId, string>> = {
    mounting: "Можем отдельно рассчитать монтаж и вывес штор.",
    rails: "Можем подобрать и рассчитать карнизы, включая электрические.",
    bedding: "При необходимости подберём постельное бельё в тон интерьеру.",
    kitchen: "Можем предложить кухонный текстиль под ваш проект.",
    bedspread: "Можем подобрать покрывало в единой цветовой гамме.",
    tulle: "Можем подобрать тюль к портьерам.",
    pillows: "Можем предложить декоративные подушки, чтобы завершить композицию.",
    curtains: "Можем рассчитать шторы или римские шторы для других зон.",
    premium: "По запросу пересчитаем проект в более премиальном исполнении.",
    discount: short?.includes("скидк") ? short : "Действует согласованная скидка при оплате в указанный срок.",
  };
  return templates[id] ?? (short || "Можем дополнительно просчитать этот вариант.");
}

export function composeCoverMessage(draft: CoverMessageDraft): string {
  const parts: string[] = [];
  const intro = [draft.introduction, draft.project_summary].filter(Boolean).join(" ").trim();
  if (intro) {
    parts.push(intro);
  }
  if (draft.included_services.trim()) {
    parts.push(draft.included_services.trim());
  }
  const offers = draft.selected_offers.map((entry) => entry.text.trim()).filter(Boolean);
  if (offers.length > 0) {
    parts.push(offers.join(" "));
  }
  if (draft.closing.trim()) {
    parts.push(draft.closing.trim());
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function messageViolatesSpec(text: string, input: CoverMessageInput): boolean {
  if (/\d+\s*[×xх]\s*\d+/u.test(text)) {
    return true;
  }
  if (/ткан[ьи]\s*:/iu.test(text)) {
    return true;
  }
  for (const item of input.proposal.items) {
    if (item.itemType === "service") {
      continue;
    }
    if (item.fabric && text.includes(item.fabric)) {
      return true;
    }
    const kind = productKind(item);
    if (kind && text.toLocaleLowerCase("ru").includes(`«${item.title.toLocaleLowerCase("ru")}»`)) {
      return true;
    }
  }
  const rubleMatches = text.match(/\d[\d\s\u00a0]*(?:₽|руб)/giu) ?? [];
  if (rubleMatches.length > 2) {
    return true;
  }
  return false;
}

export function repairPromptMissingIds(ids: CoverOfferId[]): string {
  return `В предыдущем ответе отсутствовали обязательные id в selected_offers: ${ids.join(", ")}.
Верни полный JSON заново. Каждый id из requiredOfferIds должен быть в selected_offers с непустым text.`;
}
