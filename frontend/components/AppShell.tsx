"use client";

import { CalculatorChat } from "@/components/CalculatorChat";
import { ProposalProvider, useProposal } from "@/components/ProposalProvider";
import { ProposalScreen } from "@/components/ProposalScreen";

export function AppShell() {
  return (
    <ProposalProvider>
      <ProposalApp />
    </ProposalProvider>
  );
}

function ProposalApp() {
  const { proposal, view, openProposal } = useProposal();

  return (
    <div className="flex min-h-screen flex-col">
      <nav className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 py-6 sm:px-8 lg:px-10">
        <p className="text-sm font-bold tracking-[0.24em] text-stone-950">
          PASIONARIA
        </p>
        <div className="flex items-center gap-4">
          <p className="hidden text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-stone-500 sm:block">
            AI calculator
          </p>
          <button
            type="button"
            onClick={openProposal}
            aria-label={`Коммерческое предложение, ${proposal.items.length}`}
            className="inline-flex min-h-10 items-center gap-2 border border-stone-800 px-3 text-xs font-medium text-stone-900 transition-colors duration-200 hover:bg-stone-900 hover:text-[#f7f4ec]"
          >
            <span>Коммерческое предложение</span>
            <span className="tabular-nums">{proposal.items.length}</span>
          </button>
        </div>
      </nav>

      <div hidden={view === "proposal"}>
        <CalculatorChat />
      </div>
      {view === "proposal" && <ProposalScreen />}

      <footer className="mx-auto flex w-full max-w-[1200px] justify-between gap-6 px-5 py-7 text-[0.7rem] text-stone-500 sm:px-8 lg:px-10">
        <span>Предварительный расчёт стоимости</span>
        <span>© PASIONARIA</span>
      </footer>
    </div>
  );
}
