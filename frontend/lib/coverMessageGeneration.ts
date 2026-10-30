import { formatProposalDate, formatProposalMoney } from "@/lib/proposalDocument";
import type { CoverOfferId, CoverTone } from "@/lib/proposal";
import type { CoverMessageInput, CoverMessageModelResponse } from "@/lib/coverMessageTypes";
import {
  includedServiceTitles,
  productKind,
  relationshipHints,
  selectedOfferInstructions,
} from "@/lib/coverMessageOffers";
import { COVER_OFFER_LABELS } from "@/lib/coverMessageCatalog";

const BASE_RULES = `Ты формулируешь только дополнительные предложения менеджера PASIONARIA для клиента.

Ответь ТОЛЬКО валидным JSON без markdown:
{"selected_offers":[{"id":"<id из managerSelectedOffers>","text":"фраза"}],"closing":""}

closing — необязательное короткое завершение (приглашение написать/обсудить). Можно оставить пустой строкой: подпись добавит система.

Правила для selected_offers:
- каждый id из requiredOfferIds ровно один раз, с непустым text;
- следуй instruction для id; не добавляй id вне списка;
- не отказывай в предложении, если менеджер его выбрал — предлагай дополнительный расчёт нейтрально;
- не дублируй один смысл в разных id.

Строго запрещено в text и closing:
- упоминать помещения, объект, адрес, сумму КП, услуги в составе КП;
- перечислять изделия, ткани, размеры, цены;
- утверждать, что интерьер оформлен, изделия установлены, есть готовая гамма или сочетание;
- рекламные клише: идеальный интерьер, уютная атмосфера, гармония, создать атмосферу, палитра интерьера (кроме нейтрального «подобрать в сочетании» как действие);
- слова и образы жилого объекта без подтверждения: квартира, дом, жилой интерьер, ваше жильё; не угадывать тип объекта по изделиям;
- скидки, пересчёт суммы и условия оплаты — их добавит система;
- придумывать сроки, наличие, скидки не из instruction.

relationshipHints — только подсказка к формулировке выбранных id.`;

const TONE_RULES: Record<CoverTone, string> = {
  warm: `Стиль «тёплый»: мягко, по-человечески, от «мы». Короткие живые фразы, без канцелярита и без рекламных лозунгов.`,
  business: `Стиль «деловой»: конкретно и нейтрально. Без «будем рады», без восклицаний, без образных метафор.`,
  brief: `Стиль «краткий»: каждый text — одно короткое предложение или фраза. closing — не более 5 слов или пусто. Весь ответ модели должен уложиться в 1–2 коротких предложения суммарно по text всех offers.`,
};

export function coverPrompt(input: CoverMessageInput): { system: string; user: string } {
  return {
    system: `${BASE_RULES}\n\n${TONE_RULES[input.tone]}`,
    user: JSON.stringify(coverMessageBriefForModel(input)),
  };
}

export function coverMessageBriefForModel(input: CoverMessageInput): Record<string, unknown> {
  const managerSelectedOffers = selectedOfferInstructions(input).map((entry) => ({
    id: entry.id,
    label: COVER_OFFER_LABELS[entry.id],
    instruction: entry.instruction,
  }));
  return {
    tone: input.tone,
    requiredOfferIds: input.offers,
    managerSelectedOffers,
    relationshipHints: relationshipHints(input),
    managerNotes: input.notes || null,
    note: "Фактическая часть сообщения (обращение, объект, сумма, услуги) уже сформирована сервером. Помещения используй только внутри формулировок допродаж по instruction; не перечисляй их отдельно и не повторяй фактическую часть.",
  };
}

export function roomsWithProducts(input: CoverMessageInput): string[] {
  const roomIds = new Set(
    input.proposal.items
      .filter((item) => item.itemType === "product" && item.room)
      .map((item) => item.room as string),
  );
  return input.proposal.rooms.filter((room) => roomIds.has(room.id)).map((room) => room.name);
}

function recipientFirstName(recipient: string | null): string | null {
  if (!recipient?.trim()) {
    return null;
  }
  const first = recipient.trim().split(/\s+/)[0];
  return first || null;
}

/** Нейтральная фраза о КП: без угадывания типа объекта (квартира, дом и т. п.). */
export function proposalIntroPhrase(objectName: string | null): string {
  if (objectName) {
    return `Направляем коммерческое предложение по текстильному оформлению объекта «${objectName}».`;
  }
  return "Направляем коммерческое предложение по текстильному оформлению.";
}

function serviceForIncluding(title: string): string {
  const lower = title.toLocaleLowerCase("ru");
  if (lower === "доставка") {
    return "доставку";
  }
  return lower;
}

function formatTotalLine(total: string, services: string[]): string {
  if (services.length === 1) {
    return `Общая стоимость — ${total}, включая ${serviceForIncluding(services[0])}.`;
  }
  return `Общая стоимость — ${total}.`;
}

function formatProjectCostLine(total: string, services: string[]): string {
  if (services.length === 1) {
    return `Стоимость проекта — ${total}, включая ${serviceForIncluding(services[0])}.`;
  }
  return `Стоимость проекта — ${total}.`;
}

function formatIntroCostLine(input: CoverMessageInput, services: string[]): string {
  const hasDiscount = input.proposalDiscount !== null;
  const amount = formatProposalMoney(
    hasDiscount ? input.totals.subtotal : input.totals.finalTotal,
  );
  if (hasDiscount) {
    return formatProjectCostLine(amount, services);
  }
  return formatTotalLine(amount, services);
}

export function buildServerFactualBlock(input: CoverMessageInput): string {
  const tone = input.tone;
  const services = includedServiceTitles(input);
  const objectName = input.proposal.objectName?.trim() || null;
  const name = recipientFirstName(input.proposal.recipient);
  const hasDiscount = input.proposalDiscount !== null;
  const introCost = formatIntroCostLine(input, services);

  if (tone === "brief") {
    const parts: string[] = [];
    parts.push(name ? `${name},` : "");
    if (hasDiscount) {
      parts.push("коммерческое предложение по текстильному оформлению готово.");
      parts.push(introCost);
    } else {
      parts.push(
        `коммерческое предложение по текстильному оформлению готово, итого ${formatProposalMoney(input.totals.finalTotal)}.`,
      );
      if (services.length > 0) {
        parts.push(`Включено: ${formatServiceList(services)}.`);
      }
    }
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  const lines: string[] = [];
  if (tone === "warm") {
    lines.push(name ? `${name}, добрый день!` : "Добрый день!");
  } else {
    lines.push(name ? `${name}, добрый день.` : "Добрый день.");
  }
  lines.push(proposalIntroPhrase(objectName));
  lines.push(introCost);

  if (!hasDiscount && services.length > 1) {
    lines.push(`В предложение включены: ${formatServiceList(services)}.`);
  }

  return lines.join(" ");
}

export function buildServerDiscountParagraph(input: CoverMessageInput): string {
  const discount = input.proposalDiscount;
  if (!discount) {
    return "";
  }
  const finalLabel = formatProposalMoney(input.totals.finalTotal);
  const amountLabel = formatProposalMoney(discount.amount);
  const untilLabel = discount.until ? formatProposalDate(discount.until) : null;
  const business = input.tone === "business";

  let offerSentence = "";
  if (discount.kind === "percent") {
    const pct = `${discount.value}%`;
    if (untilLabel) {
      offerSentence = business
        ? `При оплате до ${untilLabel} предусмотрена скидка ${pct} (${amountLabel}).`
        : `При оплате до ${untilLabel} предоставляем скидку ${pct} (${amountLabel}).`;
    } else {
      offerSentence = business
        ? `Предусмотрена скидка ${pct} (${amountLabel}).`
        : `Предоставляем скидку ${pct} (${amountLabel}).`;
    }
  } else {
    const fixedLabel = formatProposalMoney(discount.value);
    if (untilLabel) {
      offerSentence = business
        ? `При оплате до ${untilLabel} предусмотрена скидка ${fixedLabel}.`
        : `При оплате до ${untilLabel} предоставляем скидку ${fixedLabel}.`;
    } else {
      offerSentence = business
        ? `Предусмотрена скидка ${fixedLabel}.`
        : `Предоставляем скидку ${fixedLabel}.`;
    }
  }

  return `${offerSentence} Итоговая стоимость — ${finalLabel}.`.replace(/\s+/g, " ").trim();
}

function formatServiceList(services: string[]): string {
  if (services.length === 1) {
    return services[0].toLocaleLowerCase("ru");
  }
  return services.map((service) => service.toLocaleLowerCase("ru")).join(", ");
}

export function buildDefaultClosing(input: CoverMessageInput): string {
  const author = input.proposal.author?.trim();
  if (input.tone === "brief") {
    return author ? `${author}, PASIONARIA` : "PASIONARIA";
  }
  if (author) {
    return input.tone === "warm"
      ? `Если появятся вопросы — напишите. ${author}, PASIONARIA`
      : `Готовы ответить на вопросы. ${author}, PASIONARIA`;
  }
  return input.tone === "warm"
    ? "Если появятся вопросы — напишите. PASIONARIA"
    : "Готовы ответить на вопросы. PASIONARIA";
}

export function parseCoverMessageDraft(raw: string): CoverMessageModelResponse {
  const json = extractJsonObject(raw);
  const source = JSON.parse(json) as Record<string, unknown>;
  return {
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

function parseSelectedOffers(value: unknown): CoverMessageModelResponse["selected_offers"] {
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

export function missingOfferIds(
  draft: CoverMessageModelResponse,
  required: CoverOfferId[],
): CoverOfferId[] {
  const present = new Set(draft.selected_offers.map((entry) => entry.id));
  return required.filter((id) => !present.has(id));
}

export function mergeDraftWithFallbacks(
  draft: CoverMessageModelResponse,
  missing: CoverOfferId[],
  instructions: Array<{ id: CoverOfferId; instruction: string }>,
  tone: CoverTone,
): CoverMessageModelResponse {
  if (missing.length === 0) {
    return draft;
  }
  const byId = new Map(instructions.map((entry) => [entry.id, entry.instruction]));
  const additions = missing.map((id) => ({
    id,
    text: fallbackOfferText(id, byId.get(id) ?? "", tone),
  }));
  return {
    ...draft,
    selected_offers: [...draft.selected_offers, ...additions],
  };
}

export function fallbackOfferText(
  id: CoverOfferId,
  instruction: string,
  tone: CoverTone = "warm",
): string {
  const short = instruction.split(".")[0]?.trim();
  const templates: Partial<Record<CoverOfferId, Record<CoverTone, string>>> = {
    mounting: {
      warm: "Можем отдельно рассчитать монтаж и вывес штор.",
      business: "Дополнительно возможен расчёт монтажа и вывеса штор.",
      brief: "Монтаж — отдельный расчёт.",
    },
    rails: {
      warm: "Можем подобрать и рассчитать карнизы, включая электрические.",
      business: "Дополнительно возможен расчёт карнизов.",
      brief: "Карнизы — отдельный расчёт.",
    },
    bedding: {
      warm: "При необходимости подберём постельное бельё.",
      business: "Возможен расчёт постельного белья.",
      brief: "Постельное бельё — по запросу.",
    },
    kitchen: {
      warm: "Можем предложить кухонный текстиль под ваш проект.",
      business: "Возможен расчёт кухонного текстиля.",
      brief: "Кухонный текстиль — по запросу.",
    },
    bedspread: {
      warm: "Можем подобрать покрывало как дополнение к текстилю.",
      business: "Возможен расчёт покрывала.",
      brief: "Покрывало — отдельный расчёт.",
    },
    tulle: {
      warm: "Можем подобрать тюль к портьерам — отдельным расчётом.",
      business: "Возможен расчёт тюля к портьерам.",
      brief: "Тюль — отдельный расчёт.",
    },
    pillows: {
      warm: "Можем предложить декоративные подушки.",
      business: "Возможен расчёт декоративных подушек.",
      brief: "Подушки — по запросу.",
    },
    curtains: {
      warm: "Можем рассчитать шторы или римские шторы для других зон.",
      business: "Возможен расчёт штор или римских штор.",
      brief: "Шторы — отдельный расчёт.",
    },
    premium: {
      warm: "По запросу пересчитаем проект в более премиальном исполнении.",
      business: "Возможен пересчёт в более премиальном исполнении.",
      brief: "Премиальное исполнение — по запросу.",
    },
  };
  return templates[id]?.[tone] ?? (short || "Можем дополнительно просчитать этот вариант.");
}

export function composeCoverMessage(
  input: CoverMessageInput,
  model: CoverMessageModelResponse,
): string {
  const factual = buildServerFactualBlock(input);
  const offers = model.selected_offers.map((entry) => entry.text.trim()).filter(Boolean);
  const discountBlock = buildServerDiscountParagraph(input);
  const closing = model.closing.trim() || buildDefaultClosing(input);
  const footer = [discountBlock, closing].filter(Boolean).join(" ");

  if (input.tone === "brief") {
    const sentence = [factual, offers.join(" "), footer].filter(Boolean).join(" ");
    return sentence.replace(/\s+/g, " ").trim();
  }

  const parts = [factual];
  if (offers.length > 0) {
    parts.push(offers.join(" "));
  }
  if (footer) {
    parts.push(footer);
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

const CLICHE_PATTERN =
  /идеальн(?:ый|ого|ую|ые|ом|им)?\s+интер|уютн(?:ая|ую|ой|ые|ым)?\s+атмосф|гармон(?:ия|ии|ию|ией|ичн)|созда(?:ть|дим)\s+(?:уют|атмосф)/iu;

const RESIDENTIAL_ASSUMPTION_PATTERN =
  /(?:^|[^\p{L}])(?:кварти(?:ра|ре|ру|рой|ры)|дом(?:а|е|ом|ов)?|жил(?:ой|ое|ая|ые|ым|ых|ого|ому)?\s+интер(?:ьер|ьера|ьеру|ьером|ьере)?|ваш(?:е|а|у|им|его|ей)?\s+жиль(?:ё|е|я|ю|ем)?)(?:$|[^\p{L}])/iu;

export function messageViolatesSpec(text: string, input: CoverMessageInput): boolean {
  if (CLICHE_PATTERN.test(text)) {
    return true;
  }
  if (residentialAssumptionViolates(text, input.proposal.objectName?.trim() || null)) {
    return true;
  }
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
  const allowedRooms = roomsWithProducts(input);
  for (const room of input.proposal.rooms) {
    if (text.includes(room.name) && !allowedRooms.includes(room.name)) {
      return true;
    }
  }
  if (allowedRooms.length === 0) {
    for (const room of input.proposal.rooms) {
      if (text.includes(room.name)) {
        return true;
      }
    }
  }
  const rubleMatches = text.match(/\d[\d\s\u00a0]*(?:₽|руб)/giu) ?? [];
  const rubleLimit = input.proposalDiscount ? 4 : 2;
  if (rubleMatches.length > rubleLimit) {
    return true;
  }
  if (input.proposalDiscount && /скидк/i.test(text)) {
    const withoutServerDiscount = text.replace(buildServerDiscountParagraph(input), "");
    if (/скидк/i.test(withoutServerDiscount)) {
      return true;
    }
  }
  return false;
}

function residentialAssumptionViolates(text: string, objectName: string | null): boolean {
  if (!RESIDENTIAL_ASSUMPTION_PATTERN.test(text)) {
    return false;
  }
  const withoutConfirmedObject = objectName ? text.split(objectName).join("") : text;
  return RESIDENTIAL_ASSUMPTION_PATTERN.test(withoutConfirmedObject);
}

export function repairPromptMissingIds(ids: CoverOfferId[]): string {
  return `В предыдущем ответе отсутствовали обязательные id в selected_offers: ${ids.join(", ")}.
Верни JSON с полным массивом selected_offers. Не упоминай сумму, помещения и услуги.`;
}

export function offerMentionedTwice(text: string, offers: CoverOfferId[]): boolean {
  const lower = text.toLocaleLowerCase("ru");
  for (const id of offers) {
    for (const needle of offerNeedles(id)) {
      const matches = lower.match(new RegExp(needle, "giu"));
      if (matches && matches.length > 1) {
        return true;
      }
    }
  }
  return false;
}

function offerNeedles(id: CoverOfferId): string[] {
  switch (id) {
    case "bedding":
      return ["постельн"];
    case "pillows":
      return ["подуш"];
    case "tulle":
      return ["тюл"];
    case "bedspread":
      return ["покрывал"];
    case "curtains":
      return ["штор", "римск"];
    case "mounting":
      return ["монтаж"];
    case "rails":
      return ["карниз"];
    case "kitchen":
      return ["кухон"];
    case "premium":
      return ["премиаль"];
    default:
      return [];
  }
}
