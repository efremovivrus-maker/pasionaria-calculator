import { computeProposalTotals, parseProposal, type CommercialProposal } from "@/lib/proposal";

export const PROPOSAL_SCHEMA_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 1_500_000;
export const MAX_PHOTO_BYTES = 2_000_000;
export const AUTOSAVE_DELAY_MS = 1_500;
export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AccountFailure =
  | "unauthenticated"
  | "invalid_session"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "inactive"
  | "invalid"
  | "password_change_required"
  | "too_large"
  | "rate_limited";

export class AccountDenied extends Error {
  constructor(readonly failure: AccountFailure, message: string) {
    super(message);
    this.name = "AccountDenied";
  }
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function passwordError(password: string, email = ""): string | null {
  if (password.length < 8 || password.length > 72) {
    return "Пароль должен быть от 8 до 72 символов.";
  }
  if (email && password.toLowerCase() === email.trim().toLowerCase()) {
    return "Пароль не должен совпадать с email.";
  }
  return null;
}

export function accountEnabledOnServer(): boolean {
  return process.env.ACCOUNT_ENABLED === "true";
}

export function accountEnabledInBrowser(): boolean {
  return process.env.NEXT_PUBLIC_ACCOUNT_ENABLED === "true";
}

export function shouldRecordCalculation(
  kind: "clarification" | "result" | "unavailable" | "error",
): "success" | "diagnostic" | "skip" {
  if (kind === "result") {
    return "success";
  }
  if (kind === "unavailable" || kind === "error") {
    return "diagnostic";
  }
  return "skip";
}

export function proposalSnapshot(proposal: CommercialProposal): {
  schemaVersion: number;
  proposal: CommercialProposal;
} {
  const normalized = parseProposal(proposal);
  const snapshot = { schemaVersion: PROPOSAL_SCHEMA_VERSION, proposal: normalized };
  const encoded = JSON.stringify(snapshot);
  if (encoded.length > MAX_SNAPSHOT_BYTES) {
    throw new AccountDenied("too_large", "Коммерческое предложение слишком большое.");
  }
  if (encoded.includes("data:image")) {
    throw new AccountDenied("invalid", "Фотография должна храниться файлом, а не внутри документа.");
  }
  return snapshot;
}

export function restoreProposal(value: unknown): CommercialProposal {
  if (!value || typeof value !== "object") {
    throw new AccountDenied("invalid", "Сохранённое КП повреждено.");
  }
  const source = value as { schemaVersion?: unknown; proposal?: unknown };
  if (typeof source.schemaVersion === "number" && source.schemaVersion > PROPOSAL_SCHEMA_VERSION) {
    throw new AccountDenied("invalid", "Версия КП новее, чем эта программа.");
  }
  return parseProposal(source.proposal ?? value);
}

export function proposalTotal(proposal: CommercialProposal): number {
  return computeProposalTotals(proposal).finalTotal;
}

export function applyFreshPrices(
  proposal: CommercialProposal,
  prices: Record<string, number>,
  confirm: boolean,
): CommercialProposal {
  if (!confirm) {
    return proposal;
  }
  return {
    ...proposal,
    items: proposal.items.map((item) => {
      const next = prices[item.id];
      if (typeof next !== "number" || !Number.isFinite(next) || next < 0) {
        return item;
      }
      return { ...item, unitPrice: next, originalUnitPrice: next };
    }),
  };
}

export function autosaveReady(elapsedMs: number, dirty: boolean): boolean {
  return dirty && elapsedMs >= AUTOSAVE_DELAY_MS;
}

export type SavePhase = "saved" | "saving" | "dirty" | "error" | "conflict";

export function savePhase(input: {
  dirty: boolean;
  saving: boolean;
  error: boolean;
  conflict: boolean;
}): SavePhase {
  if (input.conflict) {
    return "conflict";
  }
  if (input.saving) {
    return "saving";
  }
  if (input.error) {
    return "error";
  }
  if (input.dirty) {
    return "dirty";
  }
  return "saved";
}

export function savePhaseLabel(phase: SavePhase): string {
  switch (phase) {
    case "saving":
      return "Сохранение…";
    case "dirty":
      return "Есть несохранённые изменения";
    case "error":
      return "Ошибка сохранения";
    case "conflict":
      return "КП изменено на другом устройстве";
    default:
      return "Сохранено";
  }
}

export function localDraftCanBeImported(proposal: CommercialProposal): boolean {
  return proposal.items.length > 0;
}

export function photoPath(ownerId: string, fileId: string): string {
  if (!isUuid(ownerId) || !isUuid(fileId)) {
    throw new AccountDenied("invalid", "Некорректный путь файла.");
  }
  return `owners/${ownerId}/files/${fileId}`;
}

export function assertPhotoFile(file: { type: string; size: number }): void {
  if (!PHOTO_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
    throw new AccountDenied("invalid", "Нужен файл JPEG, PNG или WebP не больше 2 МБ.");
  }
}

export function allowRate(
  hits: number[],
  now: number,
  limit: number,
  windowMs: number,
): boolean {
  const fresh = hits.filter((stamp) => now - stamp < windowMs);
  hits.splice(0, hits.length, ...fresh);
  if (hits.length >= limit) {
    return false;
  }
  hits.push(now);
  return true;
}
