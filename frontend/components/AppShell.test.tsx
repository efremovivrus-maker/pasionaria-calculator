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

describe("AppShell header UX", () => {
  it("returns to the calculator from KP without clearing items", async () => {
    calculate.mockResolvedValueOnce({
      type: "result",
      result: curtain,
      payload: { normalized_request: {} },
    } as never);

    render(<AppShell />);
    fireEvent.change(screen.getByRole("textbox", { name: "Опишите изделие" }), {
      target: { value: "шторы 130 на 280" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Рассчитать" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Добавить в КП" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Добавить в КП" }));
    await screen.findByRole("status");
    fireEvent.click(
      screen.getByRole("button", { name: "Коммерческое предложение, 1 позиция" }),
    );
    expect(screen.getByRole("heading", { name: "Коммерческое предложение" })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "На главную калькулятора, коммерческое предложение сохранится",
      }),
    );
    expect(screen.queryByRole("heading", { name: "Коммерческое предложение" })).toBeNull();
    expect(await screen.findByText("Шторы «Вандер»")).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem(PROPOSAL_STORAGE_KEY) ?? "{}").items).toHaveLength(
      1,
    );
  });

  it("shows toast with open KP action after adding from calculator", async () => {
    calculate.mockResolvedValueOnce({
      type: "result",
      result: curtain,
      payload: { normalized_request: {} },
    } as never);

    render(<AppShell />);
    fireEvent.change(screen.getByRole("textbox", { name: "Опишите изделие" }), {
      target: { value: "шторы" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Рассчитать" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Добавить в КП" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Добавить в КП" }));

    const toast = await screen.findByRole("status");
    expect(toast.textContent).toContain("Изделие добавлено в КП");
    expect(screen.getByRole("button", { name: "Открыть КП" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Коммерческое предложение, 1 позиция" }),
    ).toBeTruthy();
  });
});
