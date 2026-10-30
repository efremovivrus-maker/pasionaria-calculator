import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/AppShell";
import { sendChatMessage } from "@/lib/api";
import { PROPOSAL_STORAGE_KEY } from "@/lib/proposal";
import type { CalculationResult } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  sendChatMessage: vi.fn(),
  warmUpBackend: vi.fn(() => Promise.resolve()),
  CalculationResponseError: class CalculationResponseError extends Error {},
}));

const calculate = vi.mocked(sendChatMessage);

const curtain: CalculationResult = {
  status: "success",
  retailPrice: 10000,
  model: "Вандер",
  productType: "curtain",
  widthCm: 130,
  heightCm: 280,
  quantity: 2,
  fabricName: "Вандер",
  operations: [],
  extras: [],
  components: [{ category: "fabric", name: "Ткань «Вандер»", cost: 6000 }],
};

const bedspread: CalculationResult = {
  status: "success",
  retailPrice: 8703,
  model: "Софт",
  productType: "bedspread",
  widthCm: 230,
  heightCm: 250,
  quantity: 1,
  fabricName: "Софт",
  operations: [],
  extras: [],
  components: [
    { category: "fabric", name: "Ткань «Софт»", cost: 2673 },
  ],
};

const roman: CalculationResult = {
  status: "success",
  retailPrice: 4555,
  model: "Вандер",
  productType: "roman",
  widthCm: 165,
  heightCm: 180,
  quantity: 1,
  operations: [],
  extras: [],
  components: [],
};

function text(value: string | null | undefined) {
  return (value ?? "").replace(/\s/g, " ");
}

function storedItems() {
  const raw = sessionStorage.getItem(PROPOSAL_STORAGE_KEY);
  const parsed = JSON.parse(raw ?? "{}") as {
    items?: Array<Record<string, unknown>>;
    recipient?: unknown;
    author?: unknown;
  };
  return parsed;
}

async function submitCalculation(request: string) {
  const input = await screen.findByRole("textbox", { name: "Опишите изделие" });
  fireEvent.change(input, { target: { value: request } });
  const button = screen.getByRole("button", { name: "Рассчитать" });
  await waitFor(() => {
    expect(button.hasAttribute("disabled")).toBe(false);
  });
  fireEvent.click(button);
}

beforeEach(() => {
  sessionStorage.clear();
  calculate.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe("commercial proposal", () => {
  it("collects curtains and bedspreads, keeps duplicates, and survives reload", async () => {
    calculate
      .mockResolvedValueOnce({
        type: "result",
        result: curtain,
        payload: {
          normalized_request: {
            product_type: "curtain",
            model: "Вандер",
            quantity: 2,
            configuration: { heading: "люверсы" },
          },
        },
      })
      .mockResolvedValueOnce({
        type: "result",
        result: bedspread,
        payload: {
          normalized_request: {
            product_type: "bedspread",
            model: "Софт",
            configuration: { lining: "Бойл" },
            stitch: "Ромб 10×10",
          },
        },
      })
      .mockResolvedValueOnce({
        type: "result",
        result: roman,
        payload: {},
      });

    const first = render(<AppShell />);
    await submitCalculation("Две шторы Вандер 130 × 280");
    expect(await screen.findByText("Шторы «Вандер»")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Добавить в КП" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Изделие добавлено в КП",
    );
    expect(
      screen.getByRole("button", { name: "Коммерческое предложение, 1 позиция" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Новый расчёт" }));
    await submitCalculation("Покрывало Софт 230 × 250, ромб 10×10");
    expect(await screen.findByText("Покрывало «Софт»")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Добавить в КП" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Добавить в КП" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в КП" }));

    await waitFor(() => {
      expect(storedItems().items).toHaveLength(3);
    });
    const beforeReload = storedItems();
    expect(beforeReload.recipient).toBeNull();
    expect(beforeReload.author).toBeNull();
    expect(beforeReload.items?.[0]).toMatchObject({
      title: "Шторы «Вандер»",
      quantity: 2,
      originalUnitPrice: 5000,
      unitPrice: 5000,
      room: null,
    });
    expect(beforeReload.items?.[1]?.id).not.toBe(beforeReload.items?.[2]?.id);
    expect(beforeReload.items?.[1]).toMatchObject({
      title: "Покрывало «Софт»",
      unitPrice: 8703,
    });
    expect(beforeReload.items?.[2]).toMatchObject({
      title: "Покрывало «Софт»",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Коммерческое предложение, 3 позиции" }),
    );
    expect(
      within(screen.getByRole("list")).getAllByDisplayValue("Покрывало «Софт»"),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Вернуться к расчётам" }));
    expect(
      screen.getByRole("button", { name: "Коммерческое предложение, 3 позиции" }),
    ).toBeTruthy();

    first.unmount();
    render(<AppShell />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Коммерческое предложение, 3 позиции" }),
      ).toBeTruthy();
    });
    expect(storedItems().items).toHaveLength(3);

    fireEvent.click(
      screen.getByRole("button", { name: "Коммерческое предложение, 3 позиции" }),
    );
    expect(screen.getByDisplayValue("Шторы «Вандер»")).toBeTruthy();
    expect(text(screen.getByText("Итого").parentElement?.textContent)).toContain(
      "27 400",
    );
    fireEvent.click(screen.getByRole("button", { name: "Удалить позицию 1" }));
    expect(
      within(screen.getByRole("list")).queryByDisplayValue("Шторы «Вандер»"),
    ).toBeNull();
    expect(text(screen.getByText("Итого").parentElement?.textContent)).toContain(
      "17 400",
    );
    expect(
      within(screen.getByRole("list")).getAllByDisplayValue("Покрывало «Софт»"),
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Вернуться к расчётам" }));
    await submitCalculation("Римская штора Вандер 165 × 180");
    expect(await screen.findByText("Римская штора «Вандер»")).toBeTruthy();
    expect(text(screen.getByText(/4\s*555/).textContent)).toContain("4 555");
    expect(
      screen.getByRole("button", { name: "Коммерческое предложение, 2 позиции" }),
    ).toBeTruthy();
    expect(storedItems().items).toHaveLength(2);
  });

  it("does not offer the proposal action for a clarification", async () => {
    calculate.mockResolvedValueOnce({
      type: "clarification",
      question: "Уточните ширину.",
    });

    render(<AppShell />);
    await submitCalculation("Шторы");
    expect(await screen.findByText("Уточните ширину.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Добавить в КП" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Коммерческое предложение, 0 позиций" }),
    ).toBeTruthy();
  });

  it("clears the proposal only after confirmation", async () => {
    sessionStorage.setItem(
      PROPOSAL_STORAGE_KEY,
      JSON.stringify({
        items: [
          {
            id: "item-1",
            title: "Покрывало «Софт»",
            productType: "bedspread",
            model: "Софт",
            widthCm: 230,
            heightCm: 250,
            quantity: 1,
            configuration: {
              heading: null,
              mechanism: null,
              lining: null,
              mounting: null,
              dayFabric: null,
              faceFabric: null,
              stitch: null,
              filling: null,
              extraOperations: [],
              fabricName: "Софт",
              fabricConsumptionM: null,
              stitchTariffAssumed: false,
              stitchWarning: null,
              explanation: null,
            },
            components: [],
            originalUnitPrice: 8703,
            unitPrice: 8703,
            room: null,
          },
        ],
        recipient: null,
        author: null,
      }),
    );

    render(<AppShell />);
    const open = await screen.findByRole("button", {
      name: "Коммерческое предложение, 1 позиция",
    });
    fireEvent.click(open);
    fireEvent.click(screen.getByRole("button", { name: "Очистить КП" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.getByDisplayValue("Покрывало «Софт»")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Очистить КП" }));
    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));
    expect(
      screen.getByText("В коммерческом предложении пока нет позиций."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Коммерческое предложение, 0 позиций" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(storedItems().items).toEqual([]);
    });
  });
});
