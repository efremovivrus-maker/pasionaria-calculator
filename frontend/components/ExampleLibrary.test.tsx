import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("example library dialog", () => {
  it("keeps the three shortcuts and fills a request without calculating", async () => {
    calculate.mockResolvedValueOnce({
      type: "result",
      result: curtain,
      payload: { normalized_request: {} },
    } as never);

    render(<AppShell />);
    expect(screen.getByRole("button", { name: "Две шторы Вандер 130 × 280" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Римская штора Вандер 165 × 180" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Покрывало Софт 230 × 250, ромб 10×10" })).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Опишите изделие" }), {
      target: { value: "Две шторы Вандер 130 × 280" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Рассчитать" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Добавить в КП" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Добавить в КП" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Новый расчёт" }));

    fireEvent.click(screen.getByRole("button", { name: "Ещё 25 вариантов" }));
    expect(screen.getByRole("dialog", { name: "Примеры расчётов" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Портьеры", selected: true })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(5);

    fireEvent.click(screen.getByRole("tab", { name: "Декоративная фурнитура" }));
    const request = "Две портьеры «Софт» 130×261 см с однотонной репсовой лентой серого цвета по двум бокам";
    fireEvent.click(screen.getByRole("button", { name: new RegExp(request) }));

    expect(screen.queryByRole("dialog")).toBeNull();
    const field = screen.getByRole("textbox", { name: "Опишите изделие" }) as HTMLTextAreaElement;
    expect(field.value).toBe(request);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Коммерческое предложение, 1 позиция" })).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem(PROPOSAL_STORAGE_KEY) ?? "{}").items).toHaveLength(1);
  });

  it("closes on Escape without changing the draft", () => {
    render(<AppShell />);
    const field = screen.getByRole("textbox", { name: "Опишите изделие" }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "черновик" } });
    fireEvent.click(screen.getByRole("button", { name: "Ещё 25 вариантов" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(field.value).toBe("черновик");
    expect(calculate).not.toHaveBeenCalled();
  });
});
