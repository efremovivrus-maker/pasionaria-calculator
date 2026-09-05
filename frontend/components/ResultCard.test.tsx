import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adaptWebhookResponse } from "@/lib/api";
import type { CalculationResult } from "@/lib/types";

import { ResultCard } from "./ResultCard";

afterEach(cleanup);

describe("ResultCard", () => {
  it("shows every non-zero backend component", () => {
    const result: CalculationResult = {
      status: "success",
      retailPrice: 11784.4,
      model: "Прайм",
      productType: "curtain",
      widthCm: 120,
      heightCm: 280,
      quantity: 2,
      operations: [],
      extras: [],
      components: [
        { category: "fabric", name: "Ткань «Ибица»", cost: 7938 },
        {
          category: "production",
          name: "Шторная лента 6 см",
          cost: 288,
        },
        {
          category: "embroidery",
          name: "Вышивка по всей площади «Прайм»",
          cost: 2486.4,
        },
      ],
    };

    render(<ResultCard result={result} onReset={vi.fn()} />);

    expect(screen.getByText("Ткань «Ибица»")).toBeTruthy();
    expect(screen.getByText("Шторная лента 6 см")).toBeTruthy();
    expect(
      screen.getByText("Вышивка по всей площади «Прайм»"),
    ).toBeTruthy();
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
});
