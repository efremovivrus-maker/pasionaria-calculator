import { clientFabric, formatProposalDate, formatProposalMoney } from "@/lib/proposalDocument";
import {
  clientLineAmount,
  clientProposalTotal,
  clientUnitPrice,
  formatDimensions,
  parseEditableNumber,
  roundMoney,
  type CommercialProposal,
  type CoverDiscountKind,
  type CoverMessageState,
  type CoverOfferId,
  type CoverTone,
} from "@/lib/proposal";

export const COVER_OFFER_GROUPS: Array<{
  title: string;
  options: Array<{ id: CoverOfferId; label: string }>;
}> = [
  {
    title: "Услуги и комплектация",
    options: [
      { id: "mounting", label: "Рассчитать стоимость монтажа и вывеса штор." },
      {
        id: "rails",
        label: "Подобрать и рассчитать карнизы, включая обычные и электрические.",
      },
    ],
  },
  {
    title: "Дополнить интерьер текстилем",
    options: [
      { id: "bedding", label: "Предложить постельное бельё." },
      { id: "kitchen", label: "Предложить кухонный текстиль." },
      { id: "bedspread", label: "Предложить покрывало к шторам." },
      { id: "tulle", label: "Предложить тюль к портьерам." },
    ],
  },
  {
    title: "Коммерческие предложения",
    options: [
      {
        id: "premium",
        label: "Предложить пересчёт проекта в более дорогом исполнении с премиальными тканями.",
      },
      { id: "discount", label: "Предложить скидку при оплате до завтра." },
    ],
  },
];

const TONES = new Set<CoverTone>(["warm", "business", "brief"]);
const OFFER_IDS = new Set<CoverOfferId>(
  COVER_OFFER_GROUPS.flatMap((group) => group.options.map((option) => option.id)),
);

export const COVER_REQUEST_MAX_CHARS = 48_000;
export const COVER_MAX_ITEMS = 80;
export const COVER_MAX_ROOMS = 40;

export class CoverMessageError extends Error {
  constructor(readonly code: "invalid_discount" | "invalid_request" | "unavailable") {
    super(code);
  }
}

type ProductKind =
  | "curtain"
  | "roman"
  | "tulle"
  | "bedspread"
  | "bedding"
  | "kitchen"
  | "rail"
  | "mounting";

type PublicItem = {
  title: string;
  itemType: "product" | "service";
  productType: string | null;
  room: string | null;
  widthCm: number | null;
  heightCm: number | null;
  quantity: number;
  unitPrice: number;
  originalUnitPrice: number;
  fabric: string | null;
};

export type CoverMessageInput = {
  tone: CoverTone;
  offers: CoverOfferId[];
  discount: { kind: CoverDiscountKind; value: number; until: string } | null;
  notes: string;
  proposal: {
    recipient: string | null;
    author: string | null;
    objectName: string | null;
    issuedOn: string;
    roundingStep: CommercialProposal["roundingStep"];
    roundingMode: CommercialProposal["roundingMode"];
    rooms: Array<{ id: string; name: string }>;
    items: PublicItem[];
  };
};

type RoomFacts = {
  name: string;
  kinds: Set<ProductKind>;
};

export function coverDiscountReady(cover: CoverMessageState): boolean {
  if (!cover.offers.includes("discount")) {
    return true;
  }
  const value = parseEditableNumber(cover.discountValue);
  if (value === null || value <= 0) {
    return false;
  }
  if (cover.discountKind === "percent" && value > 100) {
    return false;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(cover.discountUntil);
}

export function proposalContentFingerprint(proposal: CommercialProposal): string {
  const step = proposal.roundingStep;
  const mode = proposal.roundingMode;
  return JSON.stringify({
    recipient: proposal.recipient,
    author: proposal.author,
    objectName: proposal.objectName,
    rooms: proposal.rooms.map((room) => ({ id: room.id, name: room.name })),
    items: proposal.items.map((item) => ({
      id: item.id,
      title: item.title,
      itemType: item.itemType,
      room: item.room,
      quantity: item.quantity,
      widthCm: item.widthCm,
      heightCm: item.heightCm,
      fabric: clientFabric(item),
      unitPrice: clientUnitPrice(item, step, mode),
      amount: clientLineAmount(item, step, mode),
    })),
    total: clientProposalTotal(proposal.items, step, mode),
  });
}

export function coverMessageInput(proposal: CommercialProposal): CoverMessageInput {
  const discountSelected = proposal.cover.offers.includes("discount");
  const discountValue = parseEditableNumber(proposal.cover.discountValue);
  return {
    tone: proposal.cover.tone,
    offers: proposal.cover.offers.filter((offer) => OFFER_IDS.has(offer)),
    discount:
      discountSelected && discountValue !== null && coverDiscountReady(proposal.cover)
        ? {
            kind: proposal.cover.discountKind,
            value: discountValue,
            until: proposal.cover.discountUntil,
          }
        : null,
    notes: proposal.cover.notes.trim().slice(0, 1000),
    proposal: {
      recipient: proposal.recipient,
      author: proposal.author,
      objectName: proposal.objectName,
      issuedOn: proposal.issuedOn,
      roundingStep: proposal.roundingStep,
      roundingMode: proposal.roundingMode,
      rooms: proposal.rooms.map((room) => ({ id: room.id, name: room.name })),
      items: proposal.items.map((item) => ({
        title: item.title,
        itemType: item.itemType,
        productType: item.productType,
        room: item.room,
        widthCm: item.widthCm,
        heightCm: item.heightCm,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        originalUnitPrice: item.originalUnitPrice,
        fabric: clientFabric(item),
      })),
    },
  };
}

export function coverMessageBrief(input: CoverMessageInput): Record<string, unknown> {
  const step = input.proposal.roundingStep;
  const mode = input.proposal.roundingMode;
  const items = input.proposal.items.map((item) => toPublicLine(item, step, mode));
  const rooms = input.proposal.rooms
    .map((room) => ({
      name: room.name,
      items: items.filter((item) => item.roomId === room.id && item.itemType !== "service"),
    }))
    .filter((room) => room.items.length > 0)
    .map((room) => ({
      name: room.name,
      items: room.items.map(publicLine),
    }));
  const unassigned = items
    .filter((item) => item.roomId === null && item.itemType !== "service")
    .map(publicLine);
  const services = items.filter((item) => item.itemType === "service").map(publicLine);
  const total = roundMoney(
    input.proposal.items.reduce((sum, item) => sum + clientLineAmount(item, step, mode), 0),
  );
  return {
    recipient: input.proposal.recipient,
    author: input.proposal.author,
    objectName: input.proposal.objectName,
    issuedOn: formatProposalDate(input.proposal.issuedOn),
    tone: input.tone,
    total: formatProposalMoney(total),
    rooms,
    unassignedProducts: unassigned,
    services,
    selectedOffers: input.offers,
    offerInstructions: offerInstructions(input),
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

function toPublicLine(
  item: PublicItem,
  step: CommercialProposal["roundingStep"],
  mode: CommercialProposal["roundingMode"],
) {
  return {
    roomId: item.room,
    title: item.title,
    itemType: item.itemType,
    size: formatDimensions(item.widthCm, item.heightCm),
    fabric: item.fabric,
    quantity: item.quantity,
    unitPrice: formatProposalMoney(clientUnitPrice(item, step, mode)),
    amount: formatProposalMoney(clientLineAmount(item, step, mode)),
    kind: productKind(item),
  };
}

function publicLine(item: ReturnType<typeof toPublicLine>) {
  return {
    title: item.title,
    size: item.size,
    fabric: item.fabric,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: item.amount,
  };
}

export function offerInstructions(input: CoverMessageInput): string[] {
  const rooms = roomFacts(input);
  const loose = looseKinds(input);
  const instructions: string[] = [];
  const selected = new Set(input.offers);
  if (selected.size === 0) {
    instructions.push(
      "Менеджер не выбрал дополнительные предложения. Не добавляй монтаж, карнизы, текстиль, премиальный пересчёт и скидку.",
    );
  }
  if (selected.has("mounting")) {
    instructions.push(serviceInstruction(rooms, loose, "mounting", "монтаж и вывес штор"));
  }
  if (selected.has("rails")) {
    instructions.push(serviceInstruction(rooms, loose, "rail", "карнизы, включая обычные и электрические"));
  }
  if (selected.has("bedspread")) {
    instructions.push(
      textileInstruction(rooms, loose, ["curtain", "roman"], "bedspread", "покрывало", "к шторам"),
    );
  }
  if (selected.has("tulle")) {
    instructions.push(
      textileInstruction(rooms, loose, ["curtain"], "tulle", "тюль", "к портьерам"),
    );
  }
  if (selected.has("bedding")) {
    instructions.push(namedRoomInstruction(rooms, /спальн/iu, "bedding", "постельное бельё", "спальн"));
  }
  if (selected.has("kitchen")) {
    instructions.push(namedRoomInstruction(rooms, /кухн/iu, "kitchen", "кухонный текстиль", "кухн"));
  }
  if (selected.has("premium")) {
    instructions.push(
      "Предложи дополнительно пересчитать проект в более дорогом исполнении с премиальными тканями. Не называй новую цену и не изменяй текущую сумму.",
    );
  }
  if (selected.has("discount") && input.discount) {
    const size =
      input.discount.kind === "percent"
        ? `${input.discount.value}%`
        : formatProposalMoney(input.discount.value);
    instructions.push(
      `Сообщи скидку ровно ${size} при оплате до ${formatProposalDate(input.discount.until)}. Не пересчитывай сумму КП и не называй цену после скидки.`,
    );
  }
  return instructions;
}

function serviceInstruction(
  rooms: RoomFacts[],
  loose: Set<ProductKind>,
  kind: ProductKind,
  label: string,
): string {
  const windows = rooms.filter((room) => room.kinds.has("curtain") || room.kinds.has("roman"));
  const looseWindows = loose.has("curtain") || loose.has("roman");
  if (windows.length === 0 && !looseWindows) {
    return `В проекте нет штор. Не предлагай ${label} и не придумывай помещение.`;
  }
  if (windows.length === 0) {
    if (loose.has(kind)) {
      return `${label} уже есть среди позиций без помещения. Не предлагай это повторно и не утверждай, что услуга включена в стоимость.`;
    }
    return `Предложи дополнительно рассчитать ${label} для штор в проекте. Не придумывай помещение. Это ещё не входит в КП и цены этой услуги нет.`;
  }
  const open = windows.filter((room) => !room.kinds.has(kind)).map((room) => room.name);
  const closed = windows.filter((room) => room.kinds.has(kind)).map((room) => room.name);
  if (open.length === 0) {
    return `${label} уже есть в проекте (${closed.join(", ")}). Не предлагай это повторно и не утверждай, что услуга включена в стоимость.`;
  }
  const skip = closed.length > 0 ? ` Не предлагай повторно для: ${closed.join(", ")}.` : "";
  return `Предложи дополнительно рассчитать ${label} для: ${open.join(", ")}. Это ещё не входит в КП и цены этой услуги нет.${skip}`;
}

function textileInstruction(
  rooms: RoomFacts[],
  loose: Set<ProductKind>,
  triggers: ProductKind[],
  existing: ProductKind,
  label: string,
  relation: string,
): string {
  const looseOpen = triggers.some((kind) => loose.has(kind)) && !loose.has(existing);
  const relevant = rooms.filter((room) => triggers.some((kind) => room.kinds.has(kind)));
  const open = relevant.filter((room) => !room.kinds.has(existing)).map((room) => room.name);
  const closed = rooms.filter((room) => room.kinds.has(existing)).map((room) => room.name);
  if (relevant.length === 0) {
    if (!looseOpen) {
      return `Нет помещений со шторами для предложения «${label}». Не придумывай помещение и не предлагай ${label}.`;
    }
    return `Предложи ${label} ${relation} для штор в проекте. Не придумывай помещение и не называй цену.`;
  }
  if (open.length === 0) {
    return `${label} уже есть в: ${closed.join(", ")}. Не предлагай ${label} повторно.`;
  }
  const skip = closed.length > 0 ? ` Не предлагай для: ${closed.join(", ")}.` : "";
  const extra = looseOpen ? " Также можно предложить для штор без отдельного помещения." : "";
  return `Предложи ${label} ${relation} только для: ${open.join(", ")}.${skip}${extra} Не называй цену.`;
}

function looseKinds(input: CoverMessageInput): Set<ProductKind> {
  const kinds = new Set<ProductKind>();
  for (const item of input.proposal.items) {
    if (item.room !== null) {
      continue;
    }
    const kind = productKind(item);
    if (kind) {
      kinds.add(kind);
    }
  }
  return kinds;
}

function namedRoomInstruction(
  rooms: RoomFacts[],
  pattern: RegExp,
  existing: ProductKind,
  label: string,
  roomWord: string,
): string {
  const matched = rooms.filter((room) => pattern.test(room.name));
  if (matched.length === 0) {
    return `В проекте нет помещения со словом «${roomWord}». Не придумывай такое помещение и не предлагай ${label}.`;
  }
  const open = matched.filter((room) => !room.kinds.has(existing)).map((room) => room.name);
  const closed = matched.filter((room) => room.kinds.has(existing)).map((room) => room.name);
  if (open.length === 0) {
    return `${label} уже есть в: ${closed.join(", ")}. Не предлагай это повторно.`;
  }
  const skip = closed.length > 0 ? ` Не предлагай для: ${closed.join(", ")}.` : "";
  return `Предложи ${label} только для: ${open.join(", ")}.${skip} Не называй цену.`;
}

function roomFacts(input: CoverMessageInput): RoomFacts[] {
  return input.proposal.rooms.flatMap((room) => {
    const kinds = new Set<ProductKind>();
    for (const item of input.proposal.items) {
      if (item.room !== room.id) {
        continue;
      }
      const kind = productKind(item);
      if (kind) {
        kinds.add(kind);
      }
    }
    return kinds.size > 0 ? [{ name: room.name, kinds }] : [];
  });
}

function productKind(item: {
  title: string;
  itemType: string;
  productType: string | null;
}): ProductKind | null {
  const title = item.title.toLocaleLowerCase("ru");
  if (/тюл/.test(title)) {
    return "tulle";
  }
  if (/покрывал|плед/.test(title)) {
    return "bedspread";
  }
  if (/постельн|наволоч|пододеял|простын/.test(title)) {
    return "bedding";
  }
  if (/кухон|скатерт|прихват|фартук/.test(title)) {
    return "kitchen";
  }
  if (/карниз/.test(title)) {
    return "rail";
  }
  if (/монтаж|вывес/.test(title)) {
    return "mounting";
  }
  if (item.productType === "roman" || /римск/.test(title)) {
    return "roman";
  }
  if (item.productType === "bedspread") {
    return "bedspread";
  }
  if (item.productType === "curtain" || /штор/.test(title)) {
    return "curtain";
  }
  return null;
}

const SYSTEM_PROMPT = `Ты пишешь короткое сопроводительное сообщение менеджера PASIONARIA клиенту к уже готовому коммерческому предложению.
Сообщение уйдёт в WhatsApp, Telegram или CRM. Пиши естественным русским языком: профессионально, доброжелательно и уверенно.
Без канцелярита, без навязчивых продаж, без чрезмерных комплиментов, без emoji и без markdown.

Объём: тон warm или business — примерно 70–120 слов; тон brief — примерно 40–70 слов.
Если адресат похож на имя человека, обратись по нему один раз. Если адресата нет, начни без имени.
Если указан автор, заверши сообщение его именем и словом PASIONARIA.

Кратко расскажи, что подготовлено коммерческое предложение: основные интерьерные решения, помещения и общую стоимость из данных.
Не перечисляй каждую позицию. Используй только помещения, изделия, ткани, количества и суммы из данных.
Не придумывай помещения.

Дополнительные предложения разрешены только из offerInstructions.
Не добавляй монтаж, карнизы, текстиль, премиальный пересчёт или скидку, если соответствующей инструкции нет.
Не предлагай изделие для помещения, где оно уже есть.
Если выбрано несколько допродаж, объедини близкие темы. Упомяни не больше 2–3 тематических направлений. Скидку, если она есть в данных, обязательно сохрани.

Запрещено:
- придумывать цены, скидки и сроки изготовления;
- обещать наличие товаров на складе;
- утверждать, что монтаж, карнизы или другие дополнительные услуги уже входят в сумму;
- изменять сумму коммерческого предложения или называть сумму после скидки;
- выдавать возможность дополнительного расчёта за уже готовое предложение.
Монтаж, карнизы и более дорогое исполнение предлагай только как дополнительный расчёт.
Скидку указывай ровно тем размером и с той датой окончания, которые переданы.`;

export function coverPrompt(input: CoverMessageInput): { system: string; user: string } {
  return {
    system: SYSTEM_PROMPT,
    user: JSON.stringify(coverMessageBrief(input)),
  };
}

export function parseCoverRequestBody(raw: string): unknown {
  if (raw.length > COVER_REQUEST_MAX_CHARS) {
    throw new CoverMessageError("invalid_request");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CoverMessageError("invalid_request");
  }
}

export function parseCoverMessageInput(value: unknown): CoverMessageInput {
  if (!value || typeof value !== "object") {
    throw new CoverMessageError("invalid_request");
  }
  const source = value as Record<string, unknown>;
  const proposal = source.proposal;
  if (!proposal || typeof proposal !== "object") {
    throw new CoverMessageError("invalid_request");
  }
  const document = proposal as Record<string, unknown>;
  const tone = TONES.has(source.tone as CoverTone) ? (source.tone as CoverTone) : "warm";
  const offers = Array.isArray(source.offers)
    ? source.offers.filter((offer): offer is CoverOfferId => OFFER_IDS.has(offer as CoverOfferId))
    : [];
  const discount = parseDiscount(source.discount, offers.includes("discount"));
  const rooms = Array.isArray(document.rooms)
    ? document.rooms.flatMap((room) => {
        if (!room || typeof room !== "object") {
          return [];
        }
        const entry = room as Record<string, unknown>;
        if (typeof entry.id !== "string" || typeof entry.name !== "string") {
          return [];
        }
        return [{ id: clip(entry.id, 80), name: clip(entry.name, 180) }];
      })
    : [];
  if (rooms.length > COVER_MAX_ROOMS) {
    throw new CoverMessageError("invalid_request");
  }
  const items = Array.isArray(document.items)
    ? document.items.flatMap((item) => parsePublicItem(item))
    : [];
  if (items.length > COVER_MAX_ITEMS) {
    throw new CoverMessageError("invalid_request");
  }
  return {
    tone,
    offers,
    discount,
    notes: typeof source.notes === "string" ? source.notes.trim().slice(0, 1000) : "",
    proposal: {
      recipient: optionalText(document.recipient, 180),
      author: optionalText(document.author, 180),
      objectName: optionalText(document.objectName, 180),
      issuedOn: typeof document.issuedOn === "string" ? document.issuedOn : "",
      roundingStep: document.roundingStep === 10 || document.roundingStep === 1000 ? document.roundingStep : 100,
      roundingMode: document.roundingMode === "up" ? "up" : "nearest",
      rooms,
      items,
    },
  };
}

function parseDiscount(value: unknown, selected: boolean): CoverMessageInput["discount"] {
  if (!selected) {
    return null;
  }
  if (!value || typeof value !== "object") {
    throw new CoverMessageError("invalid_discount");
  }
  const source = value as Record<string, unknown>;
  const kind = source.kind === "fixed" ? "fixed" : source.kind === "percent" ? "percent" : null;
  const amount = typeof source.value === "number" ? source.value : Number.NaN;
  const until = typeof source.until === "string" ? source.until : "";
  if (!kind || !Number.isFinite(amount) || amount <= 0 || (kind === "percent" && amount > 100)) {
    throw new CoverMessageError("invalid_discount");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new CoverMessageError("invalid_discount");
  }
  return { kind, value: amount, until };
}

function parsePublicItem(value: unknown): PublicItem[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const source = value as Record<string, unknown>;
  if (typeof source.title !== "string" || !source.title.trim()) {
    return [];
  }
  const quantity = typeof source.quantity === "number" ? source.quantity : 0;
  const unitPrice = typeof source.unitPrice === "number" ? source.unitPrice : Number.NaN;
  const originalUnitPrice =
    typeof source.originalUnitPrice === "number" ? source.originalUnitPrice : unitPrice;
  if (quantity <= 0 || !Number.isFinite(unitPrice) || !Number.isFinite(originalUnitPrice)) {
    return [];
  }
  return [
    {
      title: clip(source.title, 180),
      itemType: source.itemType === "service" ? "service" : "product",
      productType: optionalText(source.productType, 40),
      room: optionalText(source.room, 80),
      widthCm: positive(source.widthCm),
      heightCm: positive(source.heightCm),
      quantity,
      unitPrice,
      originalUnitPrice,
      fabric: optionalText(source.fabric, 120),
    },
  ];
}

function optionalText(value: unknown, max = 180): string | null {
  return typeof value === "string" && value.trim() ? clip(value, max) : null;
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function positive(value: unknown): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

