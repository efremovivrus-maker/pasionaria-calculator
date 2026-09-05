import { CalculatorChat } from "@/components/CalculatorChat";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <nav className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
        <p className="text-sm font-bold tracking-[0.24em] text-stone-950">
          PASIONARIA
        </p>
        <p className="hidden text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-stone-500 sm:block">
          AI calculator
        </p>
      </nav>

      <CalculatorChat />

      <footer className="mx-auto flex w-full max-w-[1200px] justify-between gap-6 px-5 py-7 text-[0.7rem] text-stone-500 sm:px-8 lg:px-10">
        <span>Предварительный расчёт стоимости</span>
        <span>© PASIONARIA</span>
      </footer>
    </div>
  );
}
