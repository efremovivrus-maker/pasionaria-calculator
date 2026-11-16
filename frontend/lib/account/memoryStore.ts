import { createHash, randomUUID } from "node:crypto";

import type { CommercialProposal } from "@/lib/proposal";

import {
  AccountDenied,
  passwordError,
  applyFreshPrices,
  photoPath,
  proposalSnapshot,
  proposalTotal,
  restoreProposal,
  assertPhotoFile,
} from "@/lib/account/rules";

export type AccountRole = "admin" | "manager";

export type AccountProfile = {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

export type AccountSession = {
  id: string;
  userId: string;
  expiresAt: string;
};

export type StoredCalculation = {
  id: string;
  ownerId: string;
  rawRequest: string;
  normalizedInput: Record<string, unknown>;
  result: Record<string, unknown>;
  productType: string | null;
  model: string | null;
  price: number | null;
  status: "success" | "failed";
  proposalId: string | null;
  createdAt: string;
};

export type StoredProposal = {
  id: string;
  ownerId: string;
  number: string;
  title: string;
  clientName: string | null;
  authorName: string | null;
  issuedOn: string;
  status: "draft" | "ready" | "archived";
  discount: CommercialProposal["discount"];
  total: number;
  schemaVersion: number;
  proposal: CommercialProposal;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type StoredPhoto = {
  id: string;
  ownerId: string;
  path: string;
  contentType: string;
  bytes: Uint8Array;
};

type Actor = AccountSession | null;

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

export class MemoryAccountStore {
  readonly profiles = new Map<string, AccountProfile>();
  readonly sessions = new Map<string, AccountSession>();
  readonly calculations = new Map<string, StoredCalculation>();
  readonly diagnostics: StoredCalculation[] = [];
  readonly proposals = new Map<string, StoredProposal>();
  readonly photos = new Map<string, StoredPhoto>();
  readonly photoRefs = new Map<string, Set<string>>();
  readonly grants = new Set<string>();
  private readonly passwordHashes = new Map<string, string>();

  constructor(private readonly clock: () => string = () => new Date().toISOString()) {}

  seedAdmin(email: string, password: string, name = "Администратор"): AccountProfile {
    const profile = this.insertProfile(email, name, "admin", false);
    this.passwordHashes.set(profile.id, this.passwordHash(password, profile.email));
    return profile;
  }

  createUser(actor: Actor, email: string, password: string, name = ""): AccountProfile {
    const admin = this.require(actor);
    if (admin.role !== "admin") {
      throw new AccountDenied("forbidden", "Пользователя создаёт только администратор.");
    }
    if (this.profileByEmail(email)) {
      throw new AccountDenied("invalid", "Пользователь с таким email уже есть.");
    }
    const profile = this.insertProfile(email, name, "manager", true);
    this.passwordHashes.set(profile.id, this.passwordHash(password, profile.email));
    return profile;
  }

  requestRecovery(email: string): { accepted: true } {
    this.profileByEmail(email);
    return { accepted: true };
  }

  signIn(email: string, password: string, ttlMs = 86_400_000): AccountSession {
    const profile = this.profileByEmail(email);
    const expected = profile ? this.passwordHashes.get(profile.id) : undefined;
    let actual = "";
    try {
      actual = profile ? this.passwordHash(password, profile.email) : "";
    } catch {
      actual = "";
    }
    if (!profile || actual !== expected) {
      throw new AccountDenied("invalid_session", "Неверный email или пароль.");
    }
    if (!profile.active) {
      throw new AccountDenied("inactive", "Учётная запись отключена.");
    }
    const expires = new Date(Date.parse(this.clock()) + ttlMs).toISOString();
    const session: AccountSession = { id: randomUUID(), userId: profile.id, expiresAt: expires };
    this.sessions.set(session.id, session);
    return session;
  }

  changePassword(session: Actor, currentPassword: string, nextPassword: string): void {
    const profile = this.require(session, this.clock(), true);
    if (this.passwordHashes.get(profile.id) !== this.passwordHash(currentPassword, profile.email)) {
      throw new AccountDenied("invalid_session", "Неверный email или пароль.");
    }
    this.passwordHashes.set(profile.id, this.passwordHash(nextPassword, profile.email));
    profile.mustChangePassword = false;
  }

  resetPassword(actor: Actor, userId: string, temporaryPassword: string): void {
    const admin = this.require(actor);
    if (admin.role !== "admin") {
      throw new AccountDenied("forbidden", "Сбрасывать пароль может только администратор.");
    }
    const profile = this.profiles.get(userId);
    if (!profile) {
      throw new AccountDenied("not_found", "Пользователь не найден.");
    }
    this.passwordHashes.set(profile.id, this.passwordHash(temporaryPassword, profile.email));
    profile.mustChangePassword = true;
  }

  signOut(session: Actor): void {
    if (session) {
      this.sessions.delete(session.id);
    }
  }

  require(session: Actor, now = this.clock(), allowPasswordChange = false): AccountProfile {
    if (!session) {
      throw new AccountDenied("unauthenticated", "Нужен вход.");
    }
    const current = this.sessions.get(session.id);
    if (!current || current.expiresAt <= now) {
      throw new AccountDenied("invalid_session", "Сессия недействительна.");
    }
    const profile = this.profiles.get(current.userId);
    if (!profile?.active) {
      throw new AccountDenied("inactive", "Учётная запись отключена.");
    }
    if (profile.mustChangePassword && !allowPasswordChange) {
      throw new AccountDenied("password_change_required", "Сначала смените временный пароль.");
    }
    return profile;
  }

  listProfiles(actor: Actor): AccountProfile[] {
    const profile = this.require(actor);
    if (profile.role !== "admin") {
      throw new AccountDenied("forbidden", "Список пользователей доступен администратору.");
    }
    return [...this.profiles.values()];
  }

  setActive(actor: Actor, userId: string, active: boolean): AccountProfile {
    const admin = this.require(actor);
    if (admin.role !== "admin") {
      throw new AccountDenied("forbidden", "Менять доступ может только администратор.");
    }
    const profile = this.profiles.get(userId);
    if (!profile) {
      throw new AccountDenied("not_found", "Пользователь не найден.");
    }
    profile.active = active;
    return profile;
  }

  grantRead(actor: Actor, ownerId: string): void {
    const admin = this.require(actor);
    if (admin.role !== "admin") {
      throw new AccountDenied("forbidden", "Доступ выдаёт администратор.");
    }
    if (!this.profiles.has(ownerId)) {
      throw new AccountDenied("not_found", "Пользователь не найден.");
    }
    this.grants.add(`${admin.id}:${ownerId}`);
  }

  saveCalculation(
    actor: Actor,
    input: {
      rawRequest: string;
      normalizedInput: Record<string, unknown>;
      result: Record<string, unknown>;
      productType: string | null;
      model: string | null;
      price: number | null;
      status: "success" | "failed";
    },
  ): StoredCalculation {
    const profile = this.require(actor);
    const record: StoredCalculation = {
      id: randomUUID(),
      ownerId: profile.id,
      rawRequest: input.rawRequest.slice(0, 8_000),
      normalizedInput: input.normalizedInput,
      result: input.result,
      productType: input.productType,
      model: input.model,
      price: input.price,
      status: input.status,
      proposalId: null,
      createdAt: this.clock(),
    };
    if (record.status === "failed") {
      this.diagnostics.push(record);
      return record;
    }
    this.calculations.set(record.id, record);
    return record;
  }

  listCalculations(
    actor: Actor,
    query: {
      search?: string;
      productType?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): { items: StoredCalculation[]; total: number } {
    const profile = this.require(actor);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 50);
    const page = Math.max(query.page ?? 1, 1);
    const search = query.search?.trim().toLowerCase();
    const items = [...this.calculations.values()]
      .filter((item) => item.ownerId === profile.id && item.status === "success")
      .filter((item) => (query.productType ? item.productType === query.productType : true))
      .filter((item) => (query.from ? item.createdAt.slice(0, 10) >= query.from : true))
      .filter((item) => (query.to ? item.createdAt.slice(0, 10) <= query.to : true))
      .filter((item) =>
        search
          ? `${item.rawRequest} ${item.model ?? ""}`.toLowerCase().includes(search)
          : true,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      total: items.length,
      items: items.slice((page - 1) * pageSize, page * pageSize),
    };
  }

  repeatCalculation(actor: Actor, id: string): { calculation: StoredCalculation; request: Record<string, unknown> } {
    const profile = this.require(actor);
    const calculation = this.ownCalculation(profile.id, id);
    return {
      calculation,
      request: structuredClone(calculation.normalizedInput),
    };
  }

  linkCalculation(actor: Actor, calculationId: string, proposalId: string): void {
    const profile = this.require(actor);
    const calculation = this.ownCalculation(profile.id, calculationId);
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.ownerId !== profile.id) {
      throw new AccountDenied("not_found", "КП не найдено.");
    }
    calculation.proposalId = proposalId;
  }

  saveProposal(actor: Actor, proposal: CommercialProposal, title?: string): StoredProposal {
    const profile = this.require(actor);
    const snapshot = proposalSnapshot(proposal);
    const createdAt = this.clock();
    const stored = this.materialize(profile.id, snapshot.proposal, {
      id: randomUUID(),
      number: this.nextNumber(profile.id),
      title: title?.trim() || snapshot.proposal.objectName || "Коммерческое предложение",
      status: "draft",
      version: 1,
      createdAt,
      updatedAt: createdAt,
    });
    this.proposals.set(stored.id, stored);
    this.syncPhotoRefs(stored);
    return stored;
  }

  updateProposal(
    actor: Actor,
    id: string,
    proposal: CommercialProposal,
    version: number,
  ): StoredProposal {
    const current = this.editableProposal(actor, id);
    if (current.version !== version) {
      throw new AccountDenied("conflict", "КП уже сохранено в другой версии.");
    }
    const snapshot = proposalSnapshot(proposal);
    const next = this.materialize(current.ownerId, snapshot.proposal, {
      ...current,
      version: current.version + 1,
      updatedAt: this.clock(),
    });
    this.proposals.set(next.id, next);
    this.syncPhotoRefs(next);
    return next;
  }

  openProposal(actor: Actor, id: string): StoredProposal {
    const profile = this.require(actor);
    const proposal = this.proposals.get(id);
    if (!proposal || !this.canRead(profile, proposal.ownerId)) {
      throw new AccountDenied("not_found", "КП не найдено.");
    }
    return {
      ...proposal,
      proposal: restoreProposal({ schemaVersion: proposal.schemaVersion, proposal: proposal.proposal }),
    };
  }

  listProposals(actor: Actor, status: "active" | "archived"): StoredProposal[] {
    const profile = this.require(actor);
    return [...this.proposals.values()]
      .filter((item) => item.ownerId === profile.id)
      .filter((item) => (status === "archived" ? item.status === "archived" : item.status !== "archived"))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  copyProposal(actor: Actor, id: string): StoredProposal {
    const current = this.openProposal(actor, id);
    if (current.ownerId !== this.require(actor).id) {
      throw new AccountDenied("forbidden", "Копировать можно только своё КП.");
    }
    const copy = this.saveProposal(actor, current.proposal, `${current.title} (копия)`);
    copy.status = "draft";
    return copy;
  }

  archiveProposal(actor: Actor, id: string, version: number): StoredProposal {
    const current = this.editableProposal(actor, id);
    if (current.version !== version) {
      throw new AccountDenied("conflict", "КП уже сохранено в другой версии.");
    }
    current.status = "archived";
    current.version += 1;
    current.updatedAt = this.clock();
    return current;
  }

  uploadPhoto(actor: Actor, file: { type: string; bytes: Uint8Array }): StoredPhoto {
    const profile = this.require(actor);
    assertPhotoFile({ type: file.type, size: file.bytes.byteLength });
    const id = randomUUID();
    const stored: StoredPhoto = {
      id,
      ownerId: profile.id,
      path: photoPath(profile.id, id),
      contentType: file.type,
      bytes: file.bytes,
    };
    this.photos.set(id, stored);
    this.photoRefs.set(id, new Set());
    return stored;
  }

  readPhoto(actor: Actor, id: string): StoredPhoto {
    const profile = this.require(actor);
    const photo = this.photos.get(id);
    if (!photo || !this.canRead(profile, photo.ownerId)) {
      throw new AccountDenied("not_found", "Фотография не найдена.");
    }
    return photo;
  }

  recalculate(
    actor: Actor,
    id: string,
    version: number,
    prices: Record<string, number>,
    confirm: boolean,
  ): StoredProposal {
    const current = this.editableProposal(actor, id);
    const nextProposal = applyFreshPrices(current.proposal, prices, confirm);
    if (!confirm) {
      return current;
    }
    return this.updateProposal(actor, id, nextProposal, version);
  }

  private editableProposal(actor: Actor, id: string): StoredProposal {
    const profile = this.require(actor);
    const proposal = this.proposals.get(id);
    if (!proposal || proposal.ownerId !== profile.id) {
      throw new AccountDenied("not_found", "КП не найдено.");
    }
    return proposal;
  }

  private ownCalculation(ownerId: string, id: string): StoredCalculation {
    const calculation = this.calculations.get(id);
    if (!calculation || calculation.ownerId !== ownerId) {
      throw new AccountDenied("not_found", "Расчёт не найден.");
    }
    return calculation;
  }

  private canRead(profile: AccountProfile, ownerId: string): boolean {
    return profile.id === ownerId || this.grants.has(`${profile.id}:${ownerId}`);
  }

  private passwordHash(password: string, email: string): string {
    const error = passwordError(password, email);
    if (error) {
      throw new AccountDenied("invalid", error);
    }
    return hashSecret(password);
  }

  private insertProfile(
    email: string,
    name: string,
    role: AccountRole,
    mustChangePassword: boolean,
  ): AccountProfile {
    const profile: AccountProfile = {
      id: randomUUID(),
      email: emailKey(email),
      displayName: name.trim(),
      role,
      active: true,
      mustChangePassword,
      createdAt: this.clock(),
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  private profileByEmail(email: string): AccountProfile | undefined {
    const key = emailKey(email);
    return [...this.profiles.values()].find((profile) => profile.email === key);
  }

  private nextNumber(ownerId: string): string {
    const count = [...this.proposals.values()].filter((item) => item.ownerId === ownerId).length + 1;
    return `КП-${String(count).padStart(4, "0")}`;
  }

  private materialize(
    ownerId: string,
    proposal: CommercialProposal,
    base: Omit<StoredProposal, "ownerId" | "proposal" | "discount" | "total" | "schemaVersion" | "clientName" | "authorName" | "issuedOn" | "title"> & {
      title: string;
    },
  ): StoredProposal {
    return {
      ...base,
      ownerId,
      title: proposal.objectName?.trim() || base.title,
      clientName: proposal.recipient,
      authorName: proposal.author,
      issuedOn: proposal.issuedOn,
      discount: proposal.discount,
      total: proposalTotal(proposal),
      schemaVersion: 1,
      proposal,
    };
  }

  private syncPhotoRefs(proposal: StoredProposal): void {
    const used = new Set(
      proposal.proposal.items.flatMap((item) => (item.storedPhotoId ? [item.storedPhotoId] : [])),
    );
    for (const id of used) {
      const photo = this.photos.get(id);
      if (!photo || photo.ownerId !== proposal.ownerId) {
        throw new AccountDenied("invalid", "Фотография не принадлежит этому КП.");
      }
      if (!this.photoRefs.has(id)) {
        this.photoRefs.set(id, new Set());
      }
    }
    for (const [id, refs] of this.photoRefs) {
      const linked = refs.has(proposal.id);
      if (used.has(id)) {
        refs.add(proposal.id);
      } else {
        refs.delete(proposal.id);
      }
      const photo = this.photos.get(id);
      if (photo?.ownerId === proposal.ownerId && linked && refs.size === 0) {
        this.photos.delete(id);
        this.photoRefs.delete(id);
      }
    }
  }
}
