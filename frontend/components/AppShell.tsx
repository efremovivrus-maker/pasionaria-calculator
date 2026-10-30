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
  const {
    proposal,
    view,
    openProposal,
    goToCalculator,
    kpCountPulse,
    kpToastOpen,
    dismissKpToast,
  } = useProposal();
  const itemCount = proposal.items.length;

  function openProposalFromToast() {
    dismissKpToast();
    openProposal();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-stone-300/90 bg-[#f4f1e9]/95 backdrop-blur-sm">
        <nav className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-8 sm:py-4 lg:px-10">
          <button
            type="button"
            onClick={goToCalculator}
            className="text-left text-sm font-bold tracking-[0.24em] text-stone-950 transition-colors hover:text-[#6d7565]"
            aria-label="На главную калькулятора, коммерческое предложение сохранится"
          >
            PASIONARIA
          </button>
          <div className="flex items-center gap-2 sm:gap-4">
            <p className="hidden text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-stone-500 md:block">
              AI calculator
            </p>
            <button
              type="button"
              onClick={openProposal}
              aria-label={`Коммерческое предложение, ${itemCount} ${itemLabel(itemCount)}`}
              className="inline-flex min-h-10 items-center gap-2 border border-stone-800 px-2.5 text-xs font-medium text-stone-900 transition-colors duration-200 hover:bg-stone-900 hover:text-[#f7f4ec] sm:px-3"
            >
              <span className="hidden sm:inline">Коммерческое предложение</span>
              <span className="sm:hidden">КП</span>
              <span
                key={kpCountPulse}
                className={`tabular-nums ${kpCountPulse > 0 ? "kp-count-pulse" : ""}`}
              >
                {itemCount}
              </span>
            </button>
          </div>
        </nav>
      </header>

      <div hidden={view === "proposal"}>
        <CalculatorChat />
      </div>
      {view === "proposal" && <ProposalScreen />}

      {kpToastOpen ? (
        <div
          role="status"
          aria-live="polite"
          className="kp-toast-enter pointer-events-auto fixed bottom-5 left-1/2 z-50 flex max-w-[min(100vw-2rem,28rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-2 border border-stone-300 bg-[#f8f6f0] px-4 py-3 text-sm text-stone-900 shadow-sm"
        >
          <span>Изделие добавлено в КП</span>
          <button
            type="button"
            onClick={openProposalFromToast}
            className="font-medium text-stone-900 underline decoration-stone-400 underline-offset-2 hover:decoration-stone-800"
          >
            Открыть КП
          </button>
        </div>
      ) : null}

      <footer className="mx-auto flex w-full max-w-[1200px] justify-between gap-6 px-5 py-7 text-[0.7rem] text-stone-500 sm:px-8 lg:px-10">
        <span>Предварительный расчёт стоимости</span>
        <span>© PASIONARIA</span>
      </footer>
    </div>
  );
}

function itemLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "позиция";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "позиции";
  }
  return "позиций";
}
