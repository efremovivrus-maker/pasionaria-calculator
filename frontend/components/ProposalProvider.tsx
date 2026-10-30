"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  type ProposalDiscountState,
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
  updateDiscount: (patch: Partial<ProposalDiscountState>) => void;
  removeItem: (id: string) => void;
  clearItems: () => void;
  addItemFromCalculation: (item: ProposalItem) => void;
  goToCalculator: () => void;
  kpCountPulse: number;
  kpToastOpen: boolean;
  dismissKpToast: () => void;
};

const ProposalContext = createContext<ProposalContextValue | null>(null);

export function ProposalProvider({ children }: { children: ReactNode }) {
  const [proposal, setProposal] = useState<CommercialProposal>(emptyProposal);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<ProposalView>("calculator");
  const [kpCountPulse, setKpCountPulse] = useState(0);
  const [kpToastOpen, setKpToastOpen] = useState(false);
  const kpToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissKpToast = useCallback(() => {
    setKpToastOpen(false);
    if (kpToastTimerRef.current) {
      clearTimeout(kpToastTimerRef.current);
      kpToastTimerRef.current = null;
    }
  }, []);

  const showKpAddedToast = useCallback(() => {
    setKpCountPulse((count) => count + 1);
    setKpToastOpen(true);
    if (kpToastTimerRef.current) {
      clearTimeout(kpToastTimerRef.current);
    }
    kpToastTimerRef.current = setTimeout(() => {
      setKpToastOpen(false);
      kpToastTimerRef.current = null;
    }, 5000);
  }, []);

  const goToCalculator = useCallback(() => {
    setView("calculator");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, []);

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

  useEffect(
    () => () => {
      if (kpToastTimerRef.current) {
        clearTimeout(kpToastTimerRef.current);
      }
    },
    [],
  );

  const value = useMemo<ProposalContextValue>(
    () => ({
      proposal,
      view,
      kpCountPulse,
      kpToastOpen,
      dismissKpToast,
      goToCalculator,
      openProposal: () => setView("proposal"),
      closeProposal: goToCalculator,
      addItem: (item) => {
        setProposal((current) => ({
          ...current,
          items: [...current.items, item],
        }));
      },
      addItemFromCalculation: (item) => {
        setProposal((current) => ({
          ...current,
          items: [...current.items, item],
        }));
        showKpAddedToast();
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
      updateDiscount: (patch) => {
        setProposal((current) => ({
          ...current,
          discount: { ...current.discount, ...patch },
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
    [proposal, view, kpCountPulse, kpToastOpen, dismissKpToast, goToCalculator, showKpAddedToast],
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
