import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/AppShell";
import { emptyConfiguration, emptyProposal, PROPOSAL_STORAGE_KEY } from "@/lib/proposal";

vi.mock("@/lib/api", () => ({
  sendChatMessage: vi.fn(),
  warmUpBackend: vi.fn(() => Promise.resolve()),
  CalculationResponseError: class CalculationResponseError extends Error {},
}));

const generated =
  "Анна, добрый день! Направляем коммерческое предложение по текстильному оформлению. Общая стоимость — 4 600 ₽.\n\nМожем отдельно рассчитать монтаж.\n\nЕсли появятся вопросы — напишите. Мария, PASIONARIA";

function stored() {
  return JSON.parse(sessionStorage.getItem(PROPOSAL_STORAGE_KEY) ?? "{}") as {
    recipient: string | null;
    cover: { text: string; offers: string[]; notes: string; sourceFingerprint: string | null };
  };
}

beforeEach(() => {
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  const proposal = {
    ...emptyProposal(new Date("2026-10-30T12:00:00")),
    recipient: "Анна Иванова",
    author: "Мария",
    objectName: "Квартира, Москва",
    items: [
      {
        id: "curtains",
        title: "Шторы «Вандер»",
        itemType: "product",
        productType: "curtain",
        model: "Вандер",
        widthCm: 130,
        heightCm: 280,
        quantity: 2,
        configuration: { ...emptyConfiguration(), fabricName: "Вандер" },
        components: [],
        originalUnitPrice: 2277.5,
        unitPrice: 2277.5,
        room: "living",
      },
    ],
    rooms: [{ id: "living", name: "Гостиная" }],
  };
  sessionStorage.setItem(PROPOSAL_STORAGE_KEY, JSON.stringify(proposal));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("cover message editor", () => {
  it("edits, copies and keeps the message after reload without rewriting it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: generated }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const view = render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Коммерческое предложение, 1 позиция" }));
    fireEvent.click(screen.getByRole("button", { name: "Сопроводительное сообщение" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Рассчитать стоимость монтажа и вывеса штор." }));
    fireEvent.click(screen.getByRole("button", { name: "Дополнительные настройки" }));
    fireEvent.change(screen.getByLabelText("Пожелания к сообщению"), {
      target: { value: "Без срочности" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сгенерировать сообщение" }));

    const message = (await screen.findByLabelText("Текст сообщения")) as HTMLTextAreaElement;
    expect(message.value).toBe(generated);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      offers: string[];
      proposal: { items: Array<{ title: string }>; discount: { enabled: boolean } };
    };
    expect(request.offers).toEqual(["mounting"]);
    expect(request.proposal.discount.enabled).toBe(false);
    expect(JSON.stringify(request)).not.toContain("operationId");

    fireEvent.change(message, { target: { value: "Анна, отправили предложение." } });
    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Анна, отправили предложение."));

    fireEvent.change(screen.getByLabelText("Адресат КП"), { target: { value: "Иван" } });
    expect(screen.getByRole("status").textContent).toContain("может быть неактуальным");
    expect((screen.getByLabelText("Текст сообщения") as HTMLTextAreaElement).value).toBe(
      "Анна, отправили предложение.",
    );

    const saved = stored();
    view.unmount();
    sessionStorage.setItem(PROPOSAL_STORAGE_KEY, JSON.stringify(saved));
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Коммерческое предложение, 1 позиция" }));
    expect(
      ((await screen.findByLabelText("Текст сообщения")) as HTMLTextAreaElement).value,
    ).toBe("Анна, отправили предложение.");
    expect(stored().cover.notes).toBe("Без срочности");
    expect(stored().cover.offers).toEqual(["mounting"]);
  });
});
