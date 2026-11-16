import { describe, expect, it } from "vitest";

import { MemoryAccountStore } from "@/lib/account/memoryStore";
import {
  AccountDenied,
  allowRate,
  applyFreshPrices,
  autosaveReady,
  localDraftCanBeImported,
  photoPath,
  proposalSnapshot,
  restoreProposal,
  savePhase,
  shouldRecordCalculation,
} from "@/lib/account/rules";
import { proposalPdfModel } from "@/lib/proposalDocument";
import {
  createManualItem,
  createRoom,
  emptyProposal,
  loadProposal,
  PROPOSAL_STORAGE_KEY,
  saveProposal,
  type CommercialProposal,
} from "@/lib/proposal";

function draft(title = "Шторы гостиная"): CommercialProposal {
  const proposal = emptyProposal(new Date("2026-11-16T12:00:00Z"));
  const room = createRoom("Гостиная");
  const item = createManualItem({ title, quantity: 1, unitPrice: 12000 });
  if (!room || !item) {
    throw new Error("fixture");
  }
  item.room = room.id;
  item.fabricColor = "Бирюзовый";
  item.productType = "curtain";
  item.model = "Вандер";
  item.originalUnitPrice = 12500;
  proposal.rooms = [room];
  proposal.items = [item];
  proposal.recipient = "Анна";
  proposal.author = "Мария";
  proposal.objectName = "Квартира на Патриарших";
  proposal.discount = { enabled: true, kind: "percent", value: "10", until: "2026-12-01" };
  proposal.cover = {
    tone: "warm",
    offers: ["curtains"],
    notes: "Без тюля",
    text: "Добрый день.",
    sourceFingerprint: "cover-1",
  };
  return proposal;
}

const TEMPORARY = "temporary-1";
const CHOSEN = "chosen-pass-1";

function cabinet() {
  const store = new MemoryAccountStore(() => "2026-11-16T12:00:00.000Z");
  const admin = store.seedAdmin("admin@pasionaria.test", "admin-pass-1");
  const adminSession = store.signIn(admin.email, "admin-pass-1");
  return { store, admin, adminSession };
}

function readyManager(
  store: MemoryAccountStore,
  adminSession: ReturnType<MemoryAccountStore["signIn"]>,
  email: string,
) {
  const profile = store.createUser(adminSession, email, TEMPORARY, "Менеджер");
  const session = store.signIn(email, TEMPORARY);
  store.changePassword(session, TEMPORARY, CHOSEN);
  return { profile, session };
}

describe("account access", () => {
  it("signs in with a password, requires a change, and signs out", () => {
    const store = new MemoryAccountStore(() => "2026-11-16T12:00:00.000Z");
    const admin = store.seedAdmin("admin@pasionaria.test", "admin-pass-1");
    const adminSession = store.signIn(admin.email, "admin-pass-1");
    const created = store.createUser(adminSession, "manager@pasionaria.test", TEMPORARY, "Менеджер");
    expect(JSON.stringify(created)).not.toContain(TEMPORARY);
    expect(() => store.signIn(created.email, "wrong-pass")).toThrow(AccountDenied);
    expect(store.sessions.size).toBe(1);
    const session = store.signIn(created.email, TEMPORARY);
    expect(() => store.require(session)).toThrow(AccountDenied);
    store.changePassword(session, TEMPORARY, CHOSEN);
    expect(store.require(session).email).toBe("manager@pasionaria.test");
    expect(store.require(session).mustChangePassword).toBe(false);
    expect(() => store.createUser(session, "other@pasionaria.test", TEMPORARY)).toThrow(AccountDenied);
    store.resetPassword(adminSession, created.id, "reset-pass-1");
    expect(() => store.signIn(created.email, CHOSEN)).toThrow(AccountDenied);
    const reset = store.signIn(created.email, "reset-pass-1");
    expect(() => store.require(reset)).toThrow(AccountDenied);
    store.signOut(session);
    expect(() => store.require(session)).toThrow(AccountDenied);
  });

  it("rejects an expired session, a wrong password and a disabled user", () => {
    const store = new MemoryAccountStore(() => "2026-11-16T12:00:00.000Z");
    const admin = store.seedAdmin("admin@pasionaria.test", "admin-pass-1");
    expect(store.requestRecovery(admin.email)).toEqual({ accepted: true });
    expect(store.requestRecovery("missing@pasionaria.test")).toEqual({ accepted: true });
    expect(() => store.signIn(admin.email, "wrong-pass")).toThrow(AccountDenied);
    const session = store.signIn(admin.email, "admin-pass-1", 0);
    expect(() => store.require(session, "2026-11-16T12:00:00.000Z")).toThrow(AccountDenied);
    const next = store.signIn(admin.email, "admin-pass-1");
    store.setActive(next, admin.id, false);
    expect(() => store.signIn(admin.email, "admin-pass-1")).toThrow(AccountDenied);
    expect(() => store.require(next)).toThrow(AccountDenied);
  });

  it("keeps two managers away from each other's documents", () => {
    const { store, adminSession } = cabinet();
    const first = readyManager(store, adminSession, "one@pasionaria.test");
    const sessionB = readyManager(store, adminSession, "two@pasionaria.test").session;
    const saved = store.saveProposal(first.session, draft());
    expect(() => store.openProposal(sessionB, saved.id)).toThrow(AccountDenied);
    expect(store.listProposals(sessionB, "active")).toEqual([]);
    expect(saved.ownerId).toBe(first.profile.id);
  });

  it("does not let an admin read another proposal until access is granted", () => {
    const { store, admin, adminSession } = cabinet();
    const manager = readyManager(store, adminSession, "one@pasionaria.test");
    const session = manager.session;
    const saved = store.saveProposal(session, draft());
    expect(() => store.openProposal(adminSession, saved.id)).toThrow(AccountDenied);
    store.grantRead(adminSession, manager.profile.id);
    expect(store.openProposal(adminSession, saved.id).id).toBe(saved.id);
    expect(() => store.updateProposal(adminSession, saved.id, draft(), saved.version)).toThrow(
      AccountDenied,
    );
    expect(store.listProfiles(adminSession).some((profile) => profile.id === admin.id)).toBe(true);
  });
});

describe("saved proposals", () => {
  it("saves, reopens, edits, copies and archives without moving ownership", () => {
    const { store, adminSession } = cabinet();
    const manager = readyManager(store, adminSession, "one@pasionaria.test");
    const session = manager.session;
    const saved = store.saveProposal(session, draft());
    const opened = store.openProposal(session, saved.id);
    expect(opened.proposal.recipient).toBe("Анна");
    expect(opened.proposal.items[0]?.fabricColor).toBe("Бирюзовый");
    expect(opened.proposal.cover.text).toBe("Добрый день.");
    expect(opened.total).toBeGreaterThan(0);
    const edited = structuredClone(opened.proposal);
    edited.objectName = "Дом";
    const updated = store.updateProposal(session, saved.id, edited, opened.version);
    expect(updated.version).toBe(2);
    expect(updated.title).toBe("Дом");
    const copy = store.copyProposal(session, saved.id);
    expect(copy.id).not.toBe(saved.id);
    expect(copy.proposal.objectName).toBe("Дом");
    expect(copy.ownerId).toBe(manager.profile.id);
    const archived = store.archiveProposal(session, saved.id, updated.version);
    expect(archived.status).toBe("archived");
    expect(store.listProposals(session, "active").map((item) => item.id)).toEqual([copy.id]);
    expect(store.listProposals(session, "archived").map((item) => item.id)).toEqual([saved.id]);
  });

  it("autosaves only after the delay and rejects a stale version", () => {
    expect(autosaveReady(1_499, true)).toBe(false);
    expect(autosaveReady(1_500, true)).toBe(true);
    expect(savePhase({ dirty: true, saving: false, error: false, conflict: false })).toBe("dirty");
    expect(savePhase({ dirty: false, saving: true, error: false, conflict: false })).toBe("saving");
    const { store, adminSession } = cabinet();
    const manager = readyManager(store, adminSession, "one@pasionaria.test");
    const session = manager.session;
    const saved = store.saveProposal(session, draft());
    const other = store.updateProposal(session, saved.id, draft("Другое"), saved.version);
    expect(() => store.updateProposal(session, saved.id, draft(), saved.version)).toThrow(
      AccountDenied,
    );
    expect(store.openProposal(session, saved.id).version).toBe(other.version);
    expect(store.openProposal(session, saved.id).proposal.items[0]?.title).toBe("Другое");
  });

  it("keeps historical prices until recalculation is confirmed", () => {
    const { store, adminSession } = cabinet();
    const manager = readyManager(store, adminSession, "one@pasionaria.test");
    const session = manager.session;
    const saved = store.saveProposal(session, draft());
    const price = saved.proposal.items[0]?.unitPrice ?? 0;
    const preview = store.recalculate(session, saved.id, saved.version, { [saved.proposal.items[0]!.id]: 999 }, false);
    expect(preview.proposal.items[0]?.unitPrice).toBe(price);
    const changed = store.recalculate(session, saved.id, saved.version, { [saved.proposal.items[0]!.id]: 999 }, true);
    expect(changed.proposal.items[0]?.originalUnitPrice).toBe(999);
    expect(changed.version).toBe(2);
  });
});

describe("calculation history", () => {
  it("stores a successful calculation, hides failures and repeats against fresh input", () => {
    expect(shouldRecordCalculation("clarification")).toBe("skip");
    expect(shouldRecordCalculation("result")).toBe("success");
    expect(shouldRecordCalculation("error")).toBe("diagnostic");
    const { store, adminSession } = cabinet();
    const manager = readyManager(store, adminSession, "one@pasionaria.test");
    const session = manager.session;
    const saved = store.saveCalculation(session, {
      rawRequest: "Шторы Вандер 140×270",
      normalizedInput: { product_type: "curtain", model: "Вандер", width_cm: 140, height_cm: 270, quantity: 1 },
      result: { retail_price: 8000 },
      productType: "curtain",
      model: "Вандер",
      price: 8000,
      status: "success",
    });
    store.saveCalculation(session, {
      rawRequest: "ошибка",
      normalizedInput: {},
      result: { status: "unavailable" },
      productType: null,
      model: null,
      price: null,
      status: "failed",
    });
    const page = store.listCalculations(session, { search: "вандер", productType: "curtain", from: "2026-11-01", to: "2026-11-16" });
    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe(saved.id);
    const repeated = store.repeatCalculation(session, saved.id);
    expect(repeated.request).toEqual(saved.normalizedInput);
    expect(store.listCalculations(session).items[0]?.price).toBe(8000);
    expect(store.diagnostics).toHaveLength(1);
    expect(store.listCalculations(session, { search: "ошибка" }).total).toBe(0);
  });
});

describe("private photos and local drafts", () => {
  it("restores an uploaded photo for the owner and removes it only when unused", () => {
    const { store, adminSession } = cabinet();
    const manager = readyManager(store, adminSession, "one@pasionaria.test");
    const other = readyManager(store, adminSession, "two@pasionaria.test");
    const session = manager.session;
    const stranger = other.session;
    const photo = store.uploadPhoto(session, { type: "image/png", bytes: Uint8Array.from([1, 2, 3]) });
    expect(photo.path).toBe(photoPath(manager.profile.id, photo.id));
    expect(() => photoPath(manager.profile.id, "../secret")).toThrow(AccountDenied);
    expect(() => store.uploadPhoto(session, { type: "image/gif", bytes: Uint8Array.from([1]) })).toThrow(AccountDenied);
    const first = draft();
    first.items[0]!.storedPhotoId = photo.id;
    const saved = store.saveProposal(session, first);
    const copy = store.copyProposal(session, saved.id);
    expect(store.readPhoto(session, photo.id).bytes).toEqual(Uint8Array.from([1, 2, 3]));
    expect(() => store.readPhoto(stranger, photo.id)).toThrow(AccountDenied);
    const without = structuredClone(saved.proposal);
    without.items[0]!.storedPhotoId = null;
    store.updateProposal(session, saved.id, without, saved.version);
    expect(store.readPhoto(session, photo.id).id).toBe(photo.id);
    const copyWithout = structuredClone(copy.proposal);
    copyWithout.items[0]!.storedPhotoId = null;
    store.updateProposal(session, copy.id, copyWithout, copy.version);
    expect(() => store.readPhoto(session, photo.id)).toThrow(AccountDenied);
  });

  it("imports a local draft without clearing sessionStorage", () => {
    sessionStorage.clear();
    const local = draft();
    saveProposal(local);
    expect(localDraftCanBeImported(loadProposal())).toBe(true);
    const { store, adminSession } = cabinet();
    const manager = readyManager(store, adminSession, "one@pasionaria.test");
    const session = manager.session;
    store.saveProposal(session, loadProposal());
    store.signOut(session);
    expect(sessionStorage.getItem(PROPOSAL_STORAGE_KEY)).toContain("Анна");
    expect(loadProposal().items).toHaveLength(1);
  });

  it("rejects base64 images and keeps a legacy proposal readable", () => {
    const legacy = draft();
    delete legacy.items[0]?.storedPhotoId;
    const restored = restoreProposal(JSON.parse(JSON.stringify(legacy)));
    expect(restored.items[0]?.title).toBe("Шторы гостиная");
    expect(restored.roundingStep).toBe(100);
    const model = proposalPdfModel(restored);
    expect(JSON.stringify(model)).toContain("Шторы гостиная");
    expect(JSON.stringify(model)).toContain("Гостиная");
    const poisoned = draft();
    poisoned.items[0]!.mediaImageUrl = "data:image/png;base64,AAAA";
    expect(() => proposalSnapshot(poisoned)).toThrow(AccountDenied);
    const prices = applyFreshPrices(draft(), { missing: 10 }, false);
    expect(prices.items[0]?.unitPrice).toBe(12000);
  });

  it("limits repeated sign-in attempts", () => {
    const hits: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      expect(allowRate(hits, 1_000 + index, 5, 60_000)).toBe(true);
    }
    expect(allowRate(hits, 1_100, 5, 60_000)).toBe(false);
  });
});
