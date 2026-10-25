import { describe, expect, it } from "vitest";

import { formatUnavailableMessage } from "./unavailable";

describe("formatUnavailableMessage", () => {
  it("includes the requested model for MODEL_NOT_FOUND", () => {
    expect(
      formatUnavailableMessage({
        status: "unavailable",
        reason_code: "MODEL_NOT_FOUND",
        details: {
          normalized_request: { model: "Ромашка" },
        },
      }),
    ).toBe(
      "Не удалось найти модель «Ромашка». Укажите название модели как на сайте pasionaria.ru.",
    );
  });

  it("uses the concrete backend reason for an impossible Roman size", () => {
    const reason =
      "Высота римской шторы превышает ширину используемой ткани; разворот и стачивание не разрешены.";
    expect(
      formatUnavailableMessage({
        status: "unavailable",
        reason_code: "ROMAN_TOO_HIGH",
        details: { reason },
      }),
    ).toBe(reason);
  });

  it("formats an unknown mechanism using backend options", () => {
    expect(
      formatUnavailableMessage({
        status: "unavailable",
        reason_code: "CONFIGURATION_OPTION_NOT_FOUND",
        details: {
          field: "mechanism",
          requested_value: "Премиум",
          available_options: ["Стандарт", "Эконом"],
        },
      }),
    ).toBe(
      "Не нашёл механизм «Премиум». Доступные варианты: «Стандарт» и «Эконом».",
    );
  });

  it("explains a fabric that has no product model", () => {
    expect(
      formatUnavailableMessage({
        status: "unavailable",
        reason_code: "MODEL_NOT_FOUND",
        details: {
          model: "Без модели",
          fabric_name: "Без модели",
          fabric_without_model: true,
        },
      }),
    ).toBe(
      "Ткань «Без модели» есть в справочнике, но модели шторы или римской шторы с таким названием нет.",
    );
  });

  it("shows the bedspread clarification instead of a fallback", () => {
    expect(
      formatUnavailableMessage({
        status: "unavailable",
        reason_code: "BEDSPREAD_STITCH_REQUIRED",
        message: "Для расчёта покрывала укажите рисунок стёжки. Например: Покрывало Софт 230×250, ромб 10×10",
      }),
    ).toBe(
      "Для расчёта покрывала укажите рисунок стёжки. Например: Покрывало Софт 230×250, ромб 10×10",
    );
  });

  it("uses the safe fallback for an unknown reason code", () => {
    expect(
      formatUnavailableMessage({
        status: "unavailable",
        reason_code: "NEW_UNKNOWN_REASON",
        message: "Technical text",
        details: { reason: "Untrusted text" },
      }),
    ).toBe("Не могу надёжно рассчитать этот вариант.");
  });

  it("keeps the specific problematic-model message", () => {
    expect(
      formatUnavailableMessage({
        status: "unavailable",
        reason_code: "PROBLEMATIC_MODEL",
        message: "Расчёт для этой модели пока недоступен.",
      }),
    ).toBe("Расчёт для этой модели пока недоступен.");
  });
});
