import { describe, expect, it } from "vitest";

import {
  adaptWebhookResponse,
  CalculationResponseError,
} from "./api";

describe("adaptWebhookResponse components", () => {
  it("preserves universal components from the backend", () => {
    const payload = {
      status: "success",
      calculation_id: "calc-components",
      retail_price: 11784.4,
      components: [
        { category: "fabric", name: "Ткань «Ибица»", cost: 7938 },
        {
          category: "production",
          name: "Боковые швы — 2х2",
          cost: 560,
          operation_id: "OP_044",
          quantity: 11.2,
          tariff: 50,
          unit: "МП",
        },
        {
          category: "embroidery",
          name: "Вышивка по всей площади «Прайм»",
          cost: 2486.4,
          operation_id: "OP_067",
        },
        {
          category: "production",
          name: "Остальные операции",
          cost: 800,
        },
      ],
    };
    const response = adaptWebhookResponse(payload);

    expect(response.type).toBe("result");
    if (response.type !== "result") {
      return;
    }
    expect(response.result.components).toHaveLength(4);
    expect(response.payload).toBe(payload);
    expect(response.result.components[2]).toMatchObject({
      category: "embroidery",
      cost: 2486.4,
      operationId: "OP_067",
    });
    expect(
      response.result.components.reduce(
        (total, component) => total + component.cost,
        0,
      ),
    ).toBeCloseTo(response.result.retailPrice, 2);
  });

  it("builds a complete fallback for an old response", () => {
    const response = adaptWebhookResponse({
      status: "success",
      retail_price: 11784.4,
      fabric_cost: 7938,
      operation_cost: 1360,
      extras: [
        {
          operation_id: "OP_067",
          name: "Вышивка Прайм",
          cost: 2486.4,
        },
      ],
    });

    expect(response.type).toBe("result");
    if (response.type !== "result") {
      return;
    }
    expect(response.result.components).toEqual([
      { category: "fabric", name: "Ткань", cost: 7938 },
      {
        category: "production",
        name: "Пошив и комплектующие",
        cost: 1360,
      },
      {
        category: "extra",
        name: "Дополнительные операции",
        cost: 2486.4,
      },
    ]);
    expect(
      response.result.components.some((component) => component.cost === 0),
    ).toBe(false);
  });

  it("preserves an error payload for feedback", () => {
    const payload = {
      status: "error",
      reason_code: "CALCULATION_ERROR",
      message: "Не удалось выполнить расчёт.",
    };

    try {
      adaptWebhookResponse(payload);
      throw new Error("Expected an error response");
    } catch (error) {
      expect(error).toBeInstanceOf(CalculationResponseError);
      expect((error as CalculationResponseError).payload).toBe(payload);
    }
  });
});
