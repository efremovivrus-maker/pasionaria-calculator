import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PriceLists } from "@/components/PriceLists";

const bedspreads = {
  catalog: "bedspreads",
  title: "Покрывала",
  version: "Покрывала и пледы",
  version_date: "2026-10-25",
  note: "Пометка «не завершена» относится к полноте карточки.",
  tables: [
    {
      id: "models",
      title: "Модели",
      columns: [
        { key: "model", label: "Модель" },
        { key: "construction", label: "Конструкция" },
        { key: "face_fabric", label: "Лицевая ткань" },
        { key: "default_stitch", label: "Стёжка по умолчанию" },
        { key: "calculator_status", label: "Расчёт" },
        { key: "card_status", label: "Карточка" },
        { key: "open_questions", label: "Открытые вопросы", export_only: true },
      ],
      rows: [
        {
          model: "Софт",
          article: "02-021",
          construction: "Стёганое, планки",
          face_fabric: "Софт",
          default_stitch: "Квадрат 10х10 см",
          calculator_status: "готова к расчёту",
          card_status: "Не завершена",
          open_questions: "Подкладка не упомянута.",
          details: {
            groups: [
              {
                title: "Конструкция",
                rows: [{ label: "Подкладка", value: "не упомянута" }],
              },
            ],
            questions: ["Подкладка не упомянута: нельзя выбрать тариф."],
          },
        },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("bedspread price list", () => {
  it("shows readable values and keeps long questions inside the model card", async () => {
    sessionStorage.setItem(
      "pasionaria.price-list",
      JSON.stringify({ catalogId: "bedspreads", query: "", category: "" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(bedspreads), { status: 200 })),
    );

    render(<PriceLists />);

    expect(await screen.findByText("Стёганое, планки")).toBeTruthy();
    expect(screen.getByText("готова к расчёту")).toBeTruthy();
    expect(screen.getByText("Не завершена")).toBeTruthy();
    expect(screen.queryByText("[object Object]")).toBeNull();
    expect(screen.queryByText("not_ready")).toBeNull();
    expect(screen.queryByText("Подкладка не упомянута: нельзя выбрать тариф.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Подробнее о Софт" }));
    expect(screen.getByText("не упомянута")).toBeTruthy();
    expect(screen.getByText("Подкладка не упомянута: нельзя выбрать тариф.")).toBeTruthy();
  });
});
