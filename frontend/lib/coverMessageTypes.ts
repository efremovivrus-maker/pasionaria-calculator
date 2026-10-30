import type {
  CommercialProposal,
  CoverDiscountKind,
  CoverOfferId,
  CoverTone,
  ProposalDiscountState,
} from "@/lib/proposal";

export type { CoverOfferId };

export type PublicItem = {
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

export type CoverMessageProposalDiscount = {
  kind: CoverDiscountKind;
  value: number;
  amount: number;
  until: string | null;
};

export type CoverMessageInput = {
  tone: CoverTone;
  offers: CoverOfferId[];
  totals: { subtotal: number; finalTotal: number };
  proposalDiscount: CoverMessageProposalDiscount | null;
  notes: string;
  proposal: {
    recipient: string | null;
    author: string | null;
    objectName: string | null;
    issuedOn: string;
    roundingStep: CommercialProposal["roundingStep"];
    roundingMode: CommercialProposal["roundingMode"];
    discount: ProposalDiscountState;
    rooms: Array<{ id: string; name: string }>;
    items: PublicItem[];
  };
};

/** Ответ YandexGPT: только допродажи и необязательное короткое завершение. */
export type CoverMessageModelResponse = {
  selected_offers: Array<{ id: string; text: string }>;
  closing: string;
};

/** @deprecated используйте CoverMessageModelResponse */
export type CoverMessageDraft = CoverMessageModelResponse & {
  introduction?: string;
  project_summary?: string;
  included_services?: string;
};
