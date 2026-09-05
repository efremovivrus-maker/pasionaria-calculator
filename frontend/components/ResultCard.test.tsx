import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adaptWebhookResponse } from "@/lib/api";
import type { CalculationResult } from "@/lib/types";

import { ResultCard } from "./ResultCard";

afterEach(cleanup);

describe("ResultCard", () => {
  it("shows Roman operations immediately without duplicating fabric", () => {
    const result: CalculationResult = {
      status: "success",
      retailPrice: 11410,
      model: "Вандер",
      productType: "roman",
      widthCm: 120,
      heightCm: 200,
      quantity: 2,
      fabricName: "Вандер",
      operations: [],
      extras: [],
      components: [
        { category: "fabric", name: "Ткань «Вандер»", cost: 2730 },
        {
          category: "production",
          name: "Пошив римской шторы — Стандартная сборка",
          cost: 1024,
        },
        {
          category: "hardware",
          name: "Механизм — Эконом",
          cost: 4200,
        },
        {
          category: "hardware",
          name: "Крепления к механизму — Кулиска + Кольца",
          cost: 2832,
        },
        {
          category: "production",
          name: "Монтаж римской шторы — Стандарт",
          cost: 624,
        },
      ],
    };

    render(<ResultCard result={result} onReset={vi.fn()} />);

    expect(screen.getByText("Состав расчёта")).toBeTruthy();
    expect(screen.getByText("Механизм — Эконом")).toBeTruthy();
    expect(
      screen.getByText("Крепления к механизму — Кулиска + Кольца"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/\s/g, " ") === "4 200 ₽",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Ткань «Вандер»")).toBeNull();
  });

  it("renders adapter fallback and omits zero-value groups", () => {
    const response = adaptWebhookResponse({
      status: "success",
      retail_price: 4555,
      fabric_cost: 3150,
      operation_cost: 1405,
      extras_cost: 0,
    });
    expect(response.type).toBe("result");
    if (response.type !== "result") {
      return;
    }

    render(<ResultCard result={response.result} onReset={vi.fn()} />);

    expect(screen.getAllByText("Ткань").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Пошив и комплектующие").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("Дополнительные операции")).toBeNull();
  });

  it("does not show an empty composition block", () => {
    const result: CalculationResult = {
      status: "success",
      retailPrice: 4555,
      operations: [],
      extras: [],
      components: [],
    };

    render(<ResultCard result={result} onReset={vi.fn()} />);

    expect(screen.queryByText("Состав расчёта")).toBeNull();
  });
});
