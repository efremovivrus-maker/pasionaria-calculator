import type { CalculationResult } from "@/lib/types";

type ResultCardProps = {
  result: CalculationResult;
  onReset: () => void;
};

const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const decimal = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});

function productName(type?: string) {
  return type === "roman" ? "Римская штора" : "Шторы";
}

export function ResultCard({ result, onReset }: ResultCardProps) {
  const components = result.components ?? [];
  const operationComponents = components.filter(
    (component) => component.category !== "fabric",
  );
  const groupedBreakdown = components.reduce(
    (groups, component) => {
      const label =
        component.category === "fabric"
          ? "Ткань"
          : component.category === "embroidery" ||
              component.category === "extra"
            ? "Дополнительные операции"
            : "Пошив и комплектующие";
      groups.set(label, (groups.get(label) ?? 0) + component.cost);
      return groups;
    },
    new Map<string, number>(),
  );
  const breakdown = [...groupedBreakdown.entries()].filter(
    ([, cost]) => cost !== 0,
  );

  const dimensions =
    result.widthCm !== undefined && result.heightCm !== undefined
      ? `${decimal.format(result.widthCm)} × ${decimal.format(result.heightCm)} см`
      : undefined;

  return (
    <section className="result-enter mt-8 overflow-hidden bg-[#e9e7df]">
      <div className="grid gap-10 px-6 py-8 sm:px-10 sm:py-10 md:grid-cols-[1.1fr_0.9fr]">
        <div className="flex min-h-56 flex-col justify-between">
          <div>
            <p className="mb-4 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-stone-500">
              Предварительная стоимость
            </p>
            <p className="font-editorial text-[3.6rem] leading-none tracking-[-0.04em] text-stone-950 sm:text-[4.7rem]">
              {rubles.format(result.retailPrice)}
            </p>
          </div>

          <div className="mt-10">
            <p className="text-lg font-medium text-stone-950">
              {productName(result.productType)}
              {result.model ? ` «${result.model}»` : ""}
            </p>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              {[dimensions, result.quantity && result.quantity > 1
                ? `${result.quantity} шт.`
                : undefined]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {result.fabricName && (
              <p className="mt-4 text-sm text-stone-600">
                Ткань: {result.fabricName}
                {result.fabricConsumptionM !== undefined
                  ? ` · ${decimal.format(result.fabricConsumptionM)} м`
                  : ""}
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-stone-400/50 pt-5 md:border-l md:border-t-0 md:pl-10 md:pt-1">
          <dl className="space-y-4">
            {breakdown.map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-6 text-sm"
              >
                <dt className="text-stone-600">{label}</dt>
                <dd className="font-medium tabular-nums text-stone-950">
                  {rubles.format(value)}
                </dd>
              </div>
            ))}
          </dl>

          {operationComponents.length > 0 && (
            <div className="mt-7 border-t border-stone-400/50 pt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
                Состав расчёта
              </p>
              <ul className="mt-4 space-y-3 text-xs leading-5 text-stone-600">
                {operationComponents.map(
                  (component, index) => (
                    <li
                      key={
                        component.operationId ??
                        `${component.name}-${index}`
                      }
                      className="flex justify-between gap-5"
                    >
                      <span>{component.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {rubles.format(component.cost)}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-5 border-t border-stone-400/50 px-6 py-5 sm:flex-row sm:items-center sm:px-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-700">
            Расчёт предварительный
          </p>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            Стоимость рассчитана по текущим параметрам изделия.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="min-h-11 w-full border border-stone-800 px-5 text-sm font-medium text-stone-900 transition-colors duration-200 hover:bg-stone-900 hover:text-stone-50 sm:w-auto"
        >
          Новый расчёт
        </button>
      </div>
    </section>
  );
}
