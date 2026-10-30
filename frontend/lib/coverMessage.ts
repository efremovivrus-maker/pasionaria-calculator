import { clientFabric } from "@/lib/proposalDocument";
import {
  clientLineAmount,
  clientUnitPrice,
  computeProposalTotals,
  proposalDiscountValue,
  type CommercialProposal,
  type CoverOfferId,
  type CoverTone,
} from "@/lib/proposal";

export { COVER_OFFER_GROUPS, COVER_OFFER_LABELS } from "@/lib/coverMessageCatalog";
export type { CoverMessageInput, CoverMessageDraft, PublicItem } from "@/lib/coverMessageTypes";
export {
  coverMessageBriefForModel as coverMessageBrief,
  coverPrompt,
  composeCoverMessage,
  buildServerFactualBlock,
  buildServerDiscountParagraph,
  proposalIntroPhrase,
  roomsWithProducts,
  parseCoverMessageDraft,
  missingOfferIds,
  mergeDraftWithFallbacks,
  messageViolatesSpec,
  offerMentionedTwice,
  repairPromptMissingIds,
  fallbackOfferText,
} from "@/lib/coverMessageGeneration";
export {
  selectedOfferInstructions,
  relationshipHints,
  includedServiceTitles,
  projectTextileGaps,
} from "@/lib/coverMessageOffers";

import { COVER_OFFER_ID_SET } from "@/lib/coverMessageCatalog";
import type { CoverMessageInput, CoverMessageProposalDiscount, PublicItem } from "@/lib/coverMessageTypes";
import { selectedOfferInstructions } from "@/lib/coverMessageOffers";

const TONES = new Set<CoverTone>(["warm", "business", "brief"]);

export const COVER_REQUEST_MAX_CHARS = 48_000;
export const COVER_MAX_ITEMS = 80;
export const COVER_MAX_ROOMS = 40;

export class CoverMessageError extends Error {
  constructor(readonly code: "invalid_discount" | "invalid_request" | "unavailable") {
    super(code);
  }
}

/** @deprecated use selectedOfferInstructions */
export function offerInstructions(input: CoverMessageInput): string[] {
  return selectedOfferInstructions(input).map((entry) => entry.instruction);
}

export function proposalDiscountForMessage(
  proposal: CommercialProposal,
): CoverMessageProposalDiscount | null {
  const totals = computeProposalTotals(proposal);
  if (totals.discountAmount <= 0 || !proposal.discount.enabled) {
    return null;
  }
  const value = proposalDiscountValue(proposal.discount);
  if (value === null) {
    return null;
  }
  const until = proposal.discount.until.trim();
  return {
    kind: proposal.discount.kind,
    value,
    amount: totals.discountAmount,
    until: /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : null,
  };
}

export function proposalContentFingerprint(proposal: CommercialProposal): string {
  const step = proposal.roundingStep;
  const mode = proposal.roundingMode;
  const totals = computeProposalTotals(proposal);
  return JSON.stringify({
    recipient: proposal.recipient,
    author: proposal.author,
    objectName: proposal.objectName,
    discount: proposal.discount,
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
    subtotal: totals.subtotal,
    finalTotal: totals.finalTotal,
  });
}

export function coverMessageInput(proposal: CommercialProposal): CoverMessageInput {
  const totals = computeProposalTotals(proposal);
  return {
    tone: proposal.cover.tone,
    offers: proposal.cover.offers.filter((offer) => COVER_OFFER_ID_SET.has(offer)),
    totals: { subtotal: totals.subtotal, finalTotal: totals.finalTotal },
    proposalDiscount: proposalDiscountForMessage(proposal),
    notes: proposal.cover.notes.trim().slice(0, 1000),
    proposal: {
      recipient: proposal.recipient,
      author: proposal.author,
      objectName: proposal.objectName,
      issuedOn: proposal.issuedOn,
      roundingStep: proposal.roundingStep,
      roundingMode: proposal.roundingMode,
      discount: proposal.discount,
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
    ? source.offers.filter(
        (offer): offer is CoverOfferId =>
          typeof offer === "string" &&
          offer !== "discount" &&
          COVER_OFFER_ID_SET.has(offer as CoverOfferId),
      )
    : [];
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
  const roundingStep =
    document.roundingStep === 10 || document.roundingStep === 1000 ? document.roundingStep : 100;
  const roundingMode = document.roundingMode === "up" ? "up" : "nearest";
  const discountState = parseDiscountState(document.discount);
  const totals = computeProposalTotals({
    items: items.map((item) => ({
      id: "x",
      title: item.title,
      itemType: item.itemType,
      productType: item.productType,
      model: null,
      widthCm: item.widthCm,
      heightCm: item.heightCm,
      quantity: item.quantity,
      configuration: {
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
      },
      components: [],
      originalUnitPrice: item.originalUnitPrice,
      unitPrice: item.unitPrice,
      room: item.room,
    })),
    roundingStep,
    roundingMode,
    discount: discountState,
  });
  const proposalDiscount = buildProposalDiscountMessage(discountState, totals);
  return {
    tone,
    offers,
    totals: { subtotal: totals.subtotal, finalTotal: totals.finalTotal },
    proposalDiscount,
    notes: typeof source.notes === "string" ? source.notes.trim().slice(0, 1000) : "",
    proposal: {
      recipient: optionalText(document.recipient, 180),
      author: optionalText(document.author, 180),
      objectName: optionalText(document.objectName, 180),
      issuedOn: typeof document.issuedOn === "string" ? document.issuedOn : "",
      roundingStep,
      roundingMode,
      discount: discountState,
      rooms,
      items,
    },
  };
}

function parseDiscountState(value: unknown): CommercialProposal["discount"] {
  if (!value || typeof value !== "object") {
    return { enabled: false, kind: "percent", value: "", until: "" };
  }
  const source = value as Record<string, unknown>;
  return {
    enabled: source.enabled === true,
    kind: source.kind === "fixed" ? "fixed" : "percent",
    value: typeof source.value === "string" ? source.value : "",
    until: typeof source.until === "string" ? source.until.trim().slice(0, 10) : "",
  };
}

function buildProposalDiscountMessage(
  discount: CommercialProposal["discount"],
  totals: ReturnType<typeof computeProposalTotals>,
): CoverMessageProposalDiscount | null {
  if (totals.discountAmount <= 0 || !discount.enabled) {
    return null;
  }
  const value = proposalDiscountValue(discount);
  if (value === null) {
    throw new CoverMessageError("invalid_discount");
  }
  const until = discount.until.trim();
  return {
    kind: discount.kind,
    value,
    amount: totals.discountAmount,
    until: /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : null,
  };
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
