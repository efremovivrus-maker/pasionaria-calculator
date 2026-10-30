"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyUnitRounding,
  createRoom,
  emptyProposal,
  loadProposal,
  moveItemWithinRoom,
  saveProposal,
  type CommercialProposal,
  type CoverMessageState,
  type ProposalItem,
  type RoundingMode,
  type RoundingStep,
} from "@/lib/proposal";

type ProposalView = "calculator" | "proposal";

type ProposalDocumentPatch = Partial<
  Pick<
    CommercialProposal,
    "recipient" | "author" | "objectName" | "issuedOn" | "roundingStep" | "roundingMode"
  >
>;

type ProposalItemPatch = Partial<
  Pick<ProposalItem, "title" | "quantity" | "unitPrice" | "room" | "itemType">
>;

type ProposalContextValue = {
  proposal: CommercialProposal;
  view: ProposalView;
  openProposal: () => void;
  closeProposal: () => void;
  addItem: (item: ProposalItem) => void;
  updateDocument: (patch: ProposalDocumentPatch) => void;
  updateItem: (id: string, patch: ProposalItemPatch) => void;
  moveItem: (id: string, direction: "up" | "down") => void;
  addRoom: (name: string) => void;
  renameRoom: (id: string, name: string) => void;
  removeRoom: (id: string) => void;
  applyRounding: (step: RoundingStep, mode: RoundingMode) => void;
  updateCover: (patch: Partial<CoverMessageState>) => void;
  removeItem: (id: string) => void;
  clearItems: () => void;
};

const ProposalContext = createContext<ProposalContextValue | null>(null);

export function ProposalProvider({ children }: { children: ReactNode }) {
  const [proposal, setProposal] = useState<CommercialProposal>(emptyProposal);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<ProposalView>("calculator");

  useEffect(() => {
    setProposal(loadProposal());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    saveProposal(proposal);
  }, [hydrated, proposal]);

  const value = useMemo<ProposalContextValue>(
    () => ({
      proposal,
      view,
      openProposal: () => setView("proposal"),
      closeProposal: () => setView("calculator"),
      addItem: (item) => {
        setProposal((current) => ({
          ...current,
          items: [...current.items, item],
        }));
      },
      updateDocument: (patch) => {
        setProposal((current) => ({
          ...current,
          ...patch,
        }));
      },
      updateItem: (id, patch) => {
        setProposal((current) => ({
          ...current,
          items: current.items.map((item) => {
            if (item.id !== id) {
              return item;
            }
            const next = { ...item, ...patch };
            if (item.productType !== null) {
              next.itemType = item.itemType;
            }
            if (next.itemType !== "product" && next.itemType !== "service") {
              next.itemType = item.itemType;
            }
            if (!next.title.trim()) {
              return item;
            }
            if (!Number.isFinite(next.quantity) || next.quantity <= 0) {
              return item;
            }
            if (!Number.isFinite(next.unitPrice) || next.unitPrice < 0) {
              return item;
            }
            const roomExists =
              next.room === null ||
              current.rooms.some((room) => room.id === next.room);
            return roomExists ? next : item;
          }),
        }));
      },
      moveItem: (id, direction) => {
        setProposal((current) => ({
          ...current,
          items: moveItemWithinRoom(current.items, id, direction),
        }));
      },
      addRoom: (name) => {
        const room = createRoom(name);
        if (!room) {
          return;
        }
        setProposal((current) => ({
          ...current,
          rooms: [...current.rooms, room],
        }));
      },
      renameRoom: (id, name) => {
        if (!name.trim()) {
          return;
        }
        setProposal((current) => ({
          ...current,
          rooms: current.rooms.map((room) =>
            room.id === id ? { ...room, name } : room,
          ),
        }));
      },
      removeRoom: (id) => {
        setProposal((current) => ({
          ...current,
          rooms: current.rooms.filter((room) => room.id !== id),
          items: current.items.map((item) =>
            item.room === id ? { ...item, room: null } : item,
          ),
        }));
      },
      applyRounding: (step, mode) => {
        setProposal((current) => ({
          ...current,
          roundingStep: step,
          roundingMode: mode,
          items: applyUnitRounding(current.items, step, mode),
        }));
      },
      updateCover: (patch) => {
        setProposal((current) => ({
          ...current,
          cover: { ...current.cover, ...patch },
        }));
      },
      removeItem: (id) => {
        setProposal((current) => ({
          ...current,
          items: current.items.filter((item) => item.id !== id),
        }));
      },
      clearItems: () => {
        setProposal((current) => ({
          ...current,
          items: [],
        }));
      },
    }),
    [proposal, view],
  );

  return (
    <ProposalContext.Provider value={value}>{children}</ProposalContext.Provider>
  );
}

export function useProposal(): ProposalContextValue {
  const value = useContext(ProposalContext);
  if (!value) {
    throw new Error("useProposal must be used within ProposalProvider");
  }
  return value;
}
