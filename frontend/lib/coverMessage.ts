import { clientFabric } from "@/lib/proposalDocument";
import {
  clientLineAmount,
  clientProposalTotal,
  clientUnitPrice,
  parseEditableNumber,
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
  parseCoverMessageDraft,
  missingOfferIds,
  mergeDraftWithFallbacks,
  messageViolatesSpec,
  repairPromptMissingIds,
} from "@/lib/coverMessageGeneration";
export {
  selectedOfferInstructions,
  relationshipHints,
  includedServiceTitles,
  projectTextileGaps,
} from "@/lib/coverMessageOffers";

import { COVER_OFFER_ID_SET } from "@/lib/coverMessageCatalog";
import type { CoverMessageInput, PublicItem } from "@/lib/coverMessageTypes";
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

export function coverDiscountReady(cover: CommercialProposal["cover"]): boolean {
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
    offers: proposal.cover.offers.filter((offer) => COVER_OFFER_ID_SET.has(offer)),
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
    ? source.offers.filter((offer): offer is CoverOfferId => COVER_OFFER_ID_SET.has(offer as CoverOfferId))
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
