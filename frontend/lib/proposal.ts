import type {
  CalculationResponsePayload,
  CalculationResult,
  CostComponent,
} from "@/lib/types";

export const PROPOSAL_STORAGE_KEY = "pasionaria.commercial-proposal.v1";
export const UNASSIGNED_ROOM_LABEL = "Без помещения";
export const ROUNDING_STEPS = [10, 100, 1000] as const;

export type RoundingStep = (typeof ROUNDING_STEPS)[number];
export type RoundingMode = "nearest" | "up";

export type ProposalConfiguration = {
  heading: string | null;
  mechanism: string | null;
  lining: string | null;
  mounting: string | null;
  dayFabric: string | null;
  faceFabric: string | null;
  stitch: string | null;
  filling: string | null;
  extraOperations: string[];
  fabricName: string | null;
  fabricConsumptionM: number | null;
  stitchTariffAssumed: boolean;
  stitchWarning: string | null;
  explanation: string | null;
};

export type ProposalItemType = "product" | "service";

export type ProposalItem = {
  id: string;
  title: string;
  itemType: ProposalItemType;
  productType: string | null;
  model: string | null;
  widthCm: number | null;
  heightCm: number | null;
  quantity: number;
  configuration: ProposalConfiguration;
  components: CostComponent[];
  originalUnitPrice: number;
  unitPrice: number;
  room: string | null;
};

export type ProposalRoom = {
  id: string;
  name: string;
};

export const COVER_OFFER_IDS = [
  "mounting",
  "rails",
  "bedding",
  "kitchen",
  "bedspread",
  "tulle",
  "premium",
  "discount",
] as const;

export type CoverOfferId = (typeof COVER_OFFER_IDS)[number];
export type CoverTone = "warm" | "business" | "brief";
export type CoverDiscountKind = "percent" | "fixed";

export type CoverMessageState = {
  tone: CoverTone;
  offers: CoverOfferId[];
  discountKind: CoverDiscountKind;
  discountValue: string;
  discountUntil: string;
  notes: string;
  text: string;
  sourceFingerprint: string | null;
};

export type CommercialProposal = {
  items: ProposalItem[];
  rooms: ProposalRoom[];
  recipient: string | null;
  author: string | null;
  objectName: string | null;
  issuedOn: string;
  roundingStep: RoundingStep;
  roundingMode: RoundingMode;
  cover: CoverMessageState;
};

const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const decimal = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});

export function tomorrowIsoDate(now = new Date()): string {
  return todayIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

export function emptyCoverMessage(now = new Date()): CoverMessageState {
  return {
    tone: "warm",
    offers: [],
    discountKind: "percent",
    discountValue: "",
    discountUntil: tomorrowIsoDate(now),
    notes: "",
    text: "",
    sourceFingerprint: null,
  };
}

export function emptyProposal(now = new Date()): CommercialProposal {
  return {
    items: [],
    rooms: [],
    recipient: null,
    author: null,
    objectName: null,
    issuedOn: todayIsoDate(now),
    roundingStep: 100,
    roundingMode: "nearest",
    cover: emptyCoverMessage(now),
  };
}

export function todayIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function emptyConfiguration(): ProposalConfiguration {
  return {
    heading: null,
    mechanism: null,
    lining: null,
    mounting: null,
    dayFabric: null,
    faceFabric: null,
    stitch: null,
    filling: null,
    extraOperations: [],
    fabricName: null,
    fabricConsumptionM: null,
    stitchTariffAssumed: false,
    stitchWarning: null,
    explanation: null,
  };
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const negative = value < 0;
  const [whole, fraction = ""] = Math.abs(value).toFixed(8).split(".");
  const kopecks = Number(fraction.slice(0, 2));
  const nextDigit = Number(fraction[2] ?? "0");
  const rounded = Number(whole) * 100 + kopecks + (nextDigit >= 5 ? 1 : 0);
  const amount = rounded / 100;
  return negative ? -amount : amount;
}

export function unitPriceFromTotal(total: number, quantity: number): number {
  const safeQuantity = quantity > 0 ? quantity : 1;
  return roundMoney(total / safeQuantity);
}

export function lineAmount(item: Pick<ProposalItem, "unitPrice" | "quantity">): number {
  return roundMoney(item.unitPrice * item.quantity);
}

export function roundWholeRubles(price: number, mode: RoundingMode): number {
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }
  const kopecks = Math.round(roundMoney(price) * 100);
  const units =
    mode === "up" ? Math.floor((kopecks + 99) / 100) : Math.round(kopecks / 100);
  return units;
}

export function clientUnitPrice(
  item: Pick<ProposalItem, "unitPrice" | "originalUnitPrice">,
  step: RoundingStep,
  mode: RoundingMode,
): number {
  const fromOriginal = roundToStep(item.originalUnitPrice, step, mode);
  const stored = roundMoney(item.unitPrice);
  if (stored === roundMoney(item.originalUnitPrice) || stored === fromOriginal) {
    return fromOriginal;
  }
  return roundWholeRubles(item.unitPrice, mode);
}

export function clientLineAmount(
  item: Pick<ProposalItem, "unitPrice" | "originalUnitPrice" | "quantity">,
  step: RoundingStep,
  mode: RoundingMode,
): number {
  return roundMoney(clientUnitPrice(item, step, mode) * item.quantity);
}

export function clientProposalTotal(
  items: ProposalItem[],
  step: RoundingStep,
  mode: RoundingMode,
): number {
  return roundMoney(
    items.reduce((total, item) => total + clientLineAmount(item, step, mode), 0),
  );
}

export function proposalTotal(items: ProposalItem[]): number {
  return roundMoney(
    items.reduce((total, item) => total + lineAmount(item), 0),
  );
}

export function roundToStep(
  price: number,
  step: RoundingStep,
  mode: RoundingMode,
): number {
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }
  const kopecks = Math.round(roundMoney(price) * 100);
  const stepKopecks = step * 100;
  const units =
    mode === "up"
      ? Math.floor((kopecks + stepKopecks - 1) / stepKopecks)
      : Math.round(kopecks / stepKopecks);
  return units * step;
}

export function applyUnitRounding(
  items: ProposalItem[],
  step: RoundingStep,
  mode: RoundingMode,
): ProposalItem[] {
  return items.map((item) => ({
    ...item,
    unitPrice: roundToStep(item.originalUnitPrice, step, mode),
  }));
}

export function itemsInRoom(
  items: ProposalItem[],
  roomId: string | null,
): ProposalItem[] {
  return items.filter((item) => item.room === roomId);
}

export function moveItemWithinRoom(
  items: ProposalItem[],
  itemId: string,
  direction: "up" | "down",
): ProposalItem[] {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    return items;
  }
  const room = items[index].room;
  const step = direction === "up" ? -1 : 1;
  let cursor = index + step;
  while (cursor >= 0 && cursor < items.length) {
    if (items[cursor].room === room) {
      const next = items.slice();
      const current = next[index];
      next[index] = next[cursor];
      next[cursor] = current;
      return next;
    }
    cursor += step;
  }
  return items;
}

export function createRoom(name: string): ProposalRoom | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  return { id: crypto.randomUUID(), name: trimmed };
}

const EXACT_SERVICE_TITLES = new Set(["доставка"]);

export function itemTypeFromTitle(title: string): ProposalItemType {
  return EXACT_SERVICE_TITLES.has(title.trim().toLocaleLowerCase("ru"))
    ? "service"
    : "product";
}

export function createManualItem(input: {
  title: string;
  quantity: number;
  unitPrice: number;
  itemType?: ProposalItemType;
}): ProposalItem | null {
  const title = input.title.trim();
  const quantity = positiveNumber(input.quantity);
  const unitPrice = finiteNumber(input.unitPrice);
  if (!title || quantity === null || unitPrice === null || unitPrice < 0) {
    return null;
  }
  const price = roundMoney(unitPrice);
  return {
    id: crypto.randomUUID(),
    title,
    itemType: input.itemType ?? itemTypeFromTitle(title),
    productType: null,
    model: null,
    widthCm: null,
    heightCm: null,
    quantity,
    configuration: emptyConfiguration(),
    components: [],
    originalUnitPrice: price,
    unitPrice: price,
    room: null,
  };
}

export function formatRubles(value: number): string {
  return rubles.format(value);
}

export function formatDimensions(
  widthCm: number | null,
  heightCm: number | null,
): string | null {
  if (widthCm === null || heightCm === null) {
    return null;
  }
  return `${decimal.format(widthCm)} × ${decimal.format(heightCm)} см`;
}

export function formatQuantity(quantity: number): string {
  return `${decimal.format(quantity)} шт.`;
}

export function formatEditableNumber(value: number): string {
  const rounded = roundMoney(value);
  const [whole, fraction] = rounded.toFixed(2).split(".");
  if (fraction === "00") {
    return whole;
  }
  return `${whole},${fraction.replace(/0$/, "")}`;
}

export function parseEditableNumber(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

export function proposalItemTitle(result: CalculationResult): string {
  const product =
    result.productType === "roman"
      ? "Римская штора"
      : result.productType === "bedspread"
        ? "Покрывало"
        : "Шторы";
  return result.model ? `${product} «${result.model}»` : product;
}

export function createProposalItem(
  result: CalculationResult,
  payload?: CalculationResponsePayload,
): ProposalItem {
  const request = record(payload?.normalized_request) ?? record(payload?.request);
  const quantity =
    positiveNumber(result.quantity) ??
    positiveNumber(request?.quantity) ??
    1;
  const unitPrice = unitPriceFromTotal(result.retailPrice, quantity);

  return {
    id: crypto.randomUUID(),
    title: proposalItemTitle(result),
    itemType: "product",
    productType:
      text(result.productType) ?? text(request?.product_type),
    model: text(result.model) ?? text(request?.model),
    widthCm: positiveNumber(result.widthCm) ?? positiveNumber(request?.width_cm),
    heightCm:
      positiveNumber(result.heightCm) ?? positiveNumber(request?.height_cm),
    quantity,
    configuration: configurationFrom(result, request),
    components: result.components.map((component) => ({ ...component })),
    originalUnitPrice: unitPrice,
    unitPrice,
    room: null,
  };
}

export function loadProposal(): CommercialProposal {
  try {
    const raw = globalThis.sessionStorage?.getItem(PROPOSAL_STORAGE_KEY);
    if (!raw) {
      return emptyProposal();
    }
    return parseProposal(JSON.parse(raw));
  } catch {
    return emptyProposal();
  }
}

export function saveProposal(proposal: CommercialProposal): void {
  globalThis.sessionStorage?.setItem(
    PROPOSAL_STORAGE_KEY,
    JSON.stringify(proposal),
  );
}

export function parseProposal(value: unknown): CommercialProposal {
  const source = record(value);
  if (!source) {
    return emptyProposal();
  }
  const rooms = parseRooms(source.rooms);
  const roomIds = new Set(rooms.map((room) => room.id));
  const items = Array.isArray(source.items)
    ? source.items.flatMap((item) => parseItem(item, roomIds))
    : [];
  return {
    items,
    rooms,
    recipient: text(source.recipient),
    author: text(source.author),
    objectName: text(source.objectName),
    issuedOn: parseIssuedOn(source.issuedOn),
    roundingStep: parseRoundingStep(source.roundingStep),
    roundingMode: source.roundingMode === "up" ? "up" : "nearest",
    cover: parseCoverMessage(source.cover),
  };
}

function parseCoverMessage(value: unknown): CoverMessageState {
  const source = record(value);
  const cover = emptyCoverMessage();
  if (!source) {
    return cover;
  }
  const tone = source.tone;
  const discountKind = source.discountKind;
  const offers = Array.isArray(source.offers)
    ? source.offers.filter((offer): offer is CoverOfferId =>
        COVER_OFFER_IDS.includes(offer as CoverOfferId),
      )
    : [];
  return {
    tone: tone === "business" || tone === "brief" ? tone : "warm",
    offers: [...new Set(offers)],
    discountKind: discountKind === "fixed" ? "fixed" : "percent",
    discountValue: typeof source.discountValue === "string" ? source.discountValue : "",
    discountUntil:
      typeof source.discountUntil === "string"
        ? parseIssuedOn(source.discountUntil)
        : cover.discountUntil,
    notes: typeof source.notes === "string" ? source.notes.slice(0, 1000) : "",
    text: typeof source.text === "string" ? source.text.slice(0, 4000) : "",
    sourceFingerprint: text(source.sourceFingerprint),
  };
}

function configurationFrom(
  result: CalculationResult,
  request: Record<string, unknown> | undefined,
): ProposalConfiguration {
  const configuration = record(request?.configuration) ?? {};
  return {
    heading: text(configuration.heading),
    mechanism: text(configuration.mechanism),
    lining: text(configuration.lining),
    mounting: text(configuration.mounting),
    dayFabric: text(request?.day_fabric),
    faceFabric: text(request?.face_fabric),
    stitch: text(request?.stitch),
    filling: text(request?.filling),
    extraOperations: textList(request?.extra_operations),
    fabricName: text(result.fabricName),
    fabricConsumptionM: finiteNumber(result.fabricConsumptionM),
    stitchTariffAssumed: result.stitchTariffAssumed === true,
    stitchWarning: text(result.stitchWarning),
    explanation: text(result.explanation),
  };
}

function parseRooms(value: unknown): ProposalRoom[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const source = record(item);
    const id = text(source?.id);
    const name = text(source?.name);
    if (!id || !name) {
      return [];
    }
    return [{ id, name }];
  });
}

function parseItemType(
  value: unknown,
  title: string,
  productType: string | null,
): ProposalItemType {
  if (value === "service" || value === "product") {
    return value;
  }
  if (productType) {
    return "product";
  }
  return itemTypeFromTitle(title);
}

function parseIssuedOn(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return value;
    }
  }
  return todayIsoDate();
}

function parseRoundingStep(value: unknown): RoundingStep {
  return value === 10 || value === 1000 ? value : 100;
}

function parseItem(value: unknown, roomIds: Set<string>): ProposalItem[] {
  const source = record(value);
  if (!source) {
    return [];
  }
  const id = text(source.id);
  const title = text(source.title);
  const quantity = positiveNumber(source.quantity);
  const originalUnitPrice = finiteNumber(source.originalUnitPrice);
  const unitPrice = finiteNumber(source.unitPrice);
  if (
    !id ||
    !title ||
    quantity === null ||
    originalUnitPrice === null ||
    unitPrice === null
  ) {
    return [];
  }
  return [
    {
      id,
      title,
      itemType: parseItemType(source.itemType, title, text(source.productType)),
      productType: text(source.productType),
      model: text(source.model),
      widthCm: positiveNumber(source.widthCm),
      heightCm: positiveNumber(source.heightCm),
      quantity,
      configuration: parseConfiguration(source.configuration),
      components: parseComponents(source.components),
      originalUnitPrice,
      unitPrice,
      room: roomIds.has(text(source.room) ?? "") ? text(source.room) : null,
    },
  ];
}

function parseConfiguration(value: unknown): ProposalConfiguration {
  const source = record(value);
  if (!source) {
    return emptyConfiguration();
  }
  return {
    heading: text(source.heading),
    mechanism: text(source.mechanism),
    lining: text(source.lining),
    mounting: text(source.mounting),
    dayFabric: text(source.dayFabric),
    faceFabric: text(source.faceFabric),
    stitch: text(source.stitch),
    filling: text(source.filling),
    extraOperations: textList(source.extraOperations),
    fabricName: text(source.fabricName),
    fabricConsumptionM: finiteNumber(source.fabricConsumptionM),
    stitchTariffAssumed: source.stitchTariffAssumed === true,
    stitchWarning: text(source.stitchWarning),
    explanation: text(source.explanation),
  };
}

function parseComponents(value: unknown): CostComponent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): CostComponent[] => {
    const source = record(item);
    const name = text(source?.name);
    const category = text(source?.category);
    const cost = finiteNumber(source?.cost);
    if (!source || !name || !category || cost === null) {
      return [];
    }
    return [
      {
        category,
        name,
        cost,
        operationId: text(source.operationId) ?? undefined,
        basis: text(source.basis) ?? undefined,
        quantity: finiteNumber(source.quantity) ?? undefined,
        tariff: finiteNumber(source.tariff) ?? undefined,
        unit: text(source.unit) ?? undefined,
      },
    ];
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const normalized = text(item);
    return normalized ? [normalized] : [];
  });
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}
