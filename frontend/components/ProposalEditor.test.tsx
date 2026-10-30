import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/AppShell";
import { PROPOSAL_STORAGE_KEY } from "@/lib/proposal";

vi.mock("@/lib/api", () => ({
  sendChatMessage: vi.fn(),
  warmUpBackend: vi.fn(() => Promise.resolve()),
  CalculationResponseError: class CalculationResponseError extends Error {},
}));

const configuration = {
  heading: null,
  mechanism: null,
  lining: null,
  mounting: null,
  dayFabric: null,
  faceFabric: null,
  stitch: null,
  filling: null,
  extraOperations: [],
  fabricName: null,
  fabricConsumptionM: null,
  stitchTariffAssumed: false,
  stitchWarning: null,
  explanation: null,
};

function storedProposal() {
  return JSON.parse(sessionStorage.getItem(PROPOSAL_STORAGE_KEY) ?? "{}") as {
    items: Array<Record<string, unknown>>;
    rooms: Array<{ id: string; name: string }>;
    recipient: string | null;
    author: string | null;
    objectName: string | null;
    issuedOn: string;
    roundingStep: number;
    roundingMode: string;
  };
}

function moneyText(value: string | null | undefined) {
  return (value ?? "").replace(/\s/g, " ");
}

function radio(value: string) {
  return screen.getByRole("radio", {
    name: (_name, element) =>
      element instanceof HTMLInputElement && element.value === value,
  });
}

function expandItem(position: number) {
  const expand = screen.queryByRole("button", { name: `Развернуть позицию ${position}` });
  if (expand) {
    fireEvent.click(expand);
  }
}

beforeEach(() => {
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  sessionStorage.setItem(
    PROPOSAL_STORAGE_KEY,
    JSON.stringify({
      items: [
        {
          id: "curtains",
          title: "Шторы «Вандер»",
          productType: "curtain",
          quantity: 2,
          widthCm: 130,
          heightCm: 280,
          configuration,
          components: [],
          originalUnitPrice: 4555,
          unitPrice: 4555,
          room: null,
        },
        {
          id: "soft-1",
          title: "Покрывало «Софт»",
          productType: "bedspread",
          quantity: 1,
          widthCm: 230,
          heightCm: 250,
          configuration,
          components: [],
          originalUnitPrice: 8736,
          unitPrice: 8736,
          room: null,
        },
        {
          id: "soft-2",
          title: "Покрывало «Софт»",
          productType: "bedspread",
          quantity: 1,
          widthCm: 230,
          heightCm: 250,
          configuration,
          components: [],
          originalUnitPrice: 8736,
          unitPrice: 8736,
          room: null,
        },
      ],
      recipient: null,
      author: null,
    }),
  );
});

afterEach(cleanup);

describe("proposal editor", () => {
  it("edits the document, rooms, prices and keeps the result after reload", async () => {
    const view = render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Коммерческое предложение, 3 позиции" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Настройки цен/i }));
    expect((radio("100") as HTMLInputElement).checked).toBe(true);
    expect((radio("nearest") as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByLabelText("Адресат КП"), {
      target: { value: "Клиент" },
    });
    fireEvent.change(screen.getByLabelText("Автор КП"), {
      target: { value: "Мария" },
    });
    fireEvent.change(screen.getByLabelText("Объект / адрес"), {
      target: { value: "ЖК Сад" },
    });
    fireEvent.change(screen.getByLabelText("Дата"), {
      target: { value: "2026-11-02" },
    });

    expandItem(1);
    const quantity = screen.getByRole("textbox", { name: "Количество позиции 1" });
    fireEvent.change(quantity, { target: { value: "3" } });
    fireEvent.blur(quantity);
    expect(storedProposal().items.map((item) => item.unitPrice)).toEqual([
      4555, 8736, 8736,
    ]);
    const totalsBlock = screen.getByLabelText("Итог коммерческого предложения");
    expect(moneyText(totalsBlock.textContent)).toContain("31 200");

    fireEvent.click(screen.getByRole("button", { name: "Округлить цены" }));
    expect(moneyText(totalsBlock.textContent)).toContain("31 200");

    const price = screen.getByRole("textbox", { name: "Цена за единицу позиции 2" });
    fireEvent.change(price, { target: { value: "9000" } });
    fireEvent.blur(price);
    expandItem(2);
    expect(screen.getAllByText(/Исходная цена/).length).toBeGreaterThan(0);
    expect(moneyText(totalsBlock.textContent)).toContain("31 500");

    fireEvent.click(radio("10"));
    fireEvent.click(screen.getByRole("button", { name: "Округлить цены" }));
    expect(storedProposal().items.map((item) => item.unitPrice)).toEqual([
      4560, 8740, 8740,
    ]);
    expect(storedProposal().items[1].originalUnitPrice).toBe(8736);

    fireEvent.click(screen.getByRole("button", { name: "+ Помещение" }));
    fireEvent.change(screen.getByLabelText("Название нового помещения"), {
      target: { value: "Гостиная" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Помещение" }));
    fireEvent.change(screen.getByLabelText("Название нового помещения"), {
      target: { value: "Спальня" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    const livingId = storedProposal().rooms[0].id;
    const bedroomId = storedProposal().rooms[1].id;
    expandItem(2);
    fireEvent.change(screen.getByRole("combobox", { name: "Помещение позиции 2" }), {
      target: { value: livingId },
    });
    expandItem(3);
    fireEvent.change(screen.getByRole("combobox", { name: "Помещение позиции 3" }), {
      target: { value: bedroomId },
    });

    const living = screen.getByRole("region", { name: "Гостиная" });
    const bedroom = screen.getByRole("region", { name: "Спальня" });
    expect(within(living).getByText("Покрывало «Софт»")).toBeTruthy();
    expect(within(bedroom).getByText("Покрывало «Софт»")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Без помещения" })).getByText(
        "Шторы «Вандер»",
      ),
    ).toBeTruthy();

    const roomName = within(living).getByRole("textbox", {
      name: "Название помещения Гостиная",
    });
    fireEvent.change(roomName, { target: { value: "Детская" } });
    fireEvent.blur(roomName);
    expect(screen.getByRole("region", { name: "Детская" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "+ Добавить позицию" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название произвольной позиции" }), {
      target: { value: "Доставка" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Цена произвольной позиции" }), {
      target: { value: "1500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(moneyText(totalsBlock.textContent)).toContain("32 660");
    const deliveryBefore = storedProposal().items.find((entry) => entry.title === "Доставка");
    expandItem(4);
    fireEvent.change(screen.getByRole("combobox", { name: "Тип позиции 4" }), {
      target: { value: "service" },
    });
    const deliveryAfter = storedProposal().items.find((entry) => entry.title === "Доставка");
    expect(deliveryAfter).toMatchObject({
      itemType: "service",
      unitPrice: deliveryBefore?.unitPrice,
      originalUnitPrice: deliveryBefore?.originalUnitPrice,
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Помещение позиции 4" }), {
      target: { value: storedProposal().rooms[0].id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Свернуть позицию 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Выше позиции 4" }));
    expect(
      storedProposal()
        .items.filter((item) => item.room === storedProposal().rooms[0].id)
        .map((item) => item.title),
    ).toEqual(["Доставка", "Покрывало «Софт»"]);

    await waitFor(() => {
      expect(storedProposal().recipient).toBe("Клиент");
    });
    view.unmount();
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Коммерческое предложение, 4 позиции" }),
    );
    expect(screen.getByLabelText("Адресат КП")).toHaveProperty("value", "Клиент");
    expect(screen.getByLabelText("Автор КП")).toHaveProperty("value", "Мария");
    expect(screen.getByLabelText("Объект / адрес")).toHaveProperty("value", "ЖК Сад");
    expect(screen.getByLabelText("Дата")).toHaveProperty("value", "2026-11-02");
    expect(screen.getByRole("region", { name: "Детская" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Спальня" })).toBeTruthy();
    expect(screen.getByText("Доставка")).toBeTruthy();
  });
});
