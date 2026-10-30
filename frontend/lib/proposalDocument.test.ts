import { describe, expect, it } from "vitest";

import {
  emptyConfiguration,
  emptyProposal,
  clientProposalTotal,
  computeProposalTotals,
  wholeRubles,
  lineAmount,
  proposalTotal,
  type ProposalItem,
} from "@/lib/proposal";

import {
  CLIENT_CONFIRMATION_NOTE,
  clientCharacteristics,
  clientPdfDetailLines,
  formatProposalDate,
  formatProposalMoney,
  itemNeedsConfirmation,
  proposalPdfFilename,
  proposalPdfModel,
} from "./proposalDocument";

const technicalWarning =
  "Тариф стёжки „Хьюго“ отсутствует в справочнике. Стоимость рассчитана по базовому тарифу 180 ₽/м² и требует подтверждения";

function item(
  overrides: Partial<ProposalItem> & Pick<ProposalItem, "id" | "title">,
): ProposalItem {
  return {
    itemType: "product",
    productType: "bedspread",
    model: null,
    widthCm: null,
    heightCm: null,
    quantity: 1,
    components: [],
    originalUnitPrice: 1000,
    unitPrice: 1000,
    room: null,
    ...overrides,
    configuration: {
      ...emptyConfiguration(),
      ...overrides.configuration,
    },
  };
}

describe("proposal pdf model", () => {
  it("formats the issue date and file name", () => {
    expect(formatProposalDate("2026-10-30")).toBe("30 октября 2026");
    expect(
      proposalPdfFilename({ ...emptyProposal(), issuedOn: "2026-11-02" }),
    ).toBe("PASIONARIA-КП-2026-11-02.pdf");
  });

  it("keeps editor order, final prices and client-facing details", () => {
    const curtains = item({
      id: "curtains",
      title: "Шторы «Вандер» с очень длинным индивидуальным названием для гостиной",
      productType: "curtain",
      model: "Вандер",
      widthCm: 130,
      heightCm: 280,
      quantity: 2,
      originalUnitPrice: 4555,
      unitPrice: 4600,
      room: null,
      configuration: {
        ...emptyConfiguration(),
        heading: "люверсы",
        mechanism: null,
        fabricName: "Вандер",
        fabricConsumptionM: 6.25,
        extraOperations: ["подгиб"],
      },
      components: [
        {
          category: "fabric",
          name: "Ткань «Вандер», операция BSD-FAB-01",
          cost: 6000,
          operationId: "BSD-FAB-01",
          tariff: 1608,
        },
      ],
    });
    const assumed = item({
      id: "soft",
      title: "Покрывало «Софт»",
      widthCm: 230,
      heightCm: 250,
      quantity: 2,
      originalUnitPrice: 8703,
      unitPrice: 8800,
      room: "living",
      configuration: {
        ...emptyConfiguration(),
        fabricName: "Софт",
        faceFabric: "Софт",
        stitch: "Хьюго",
        lining: "Бойл",
        filling: "200 г/м²",
        fabricConsumptionM: 2.7,
        stitchTariffAssumed: true,
        stitchWarning: technicalWarning,
        explanation: `default_stitch_assumed ${technicalWarning}`,
      },
      components: [
        {
          category: "production",
          name: "Стежка покрывала — Хьюго",
          cost: 864,
          operationId: "BSD-STITCH-Квадрат 5х5 см",
          tariff: 180,
        },
      ],
    });
    const delivery = item({
      id: "delivery",
      title: "Доставка",
      itemType: "service",
      productType: null,
      quantity: 1,
      originalUnitPrice: 1550,
      unitPrice: 1600,
      room: "living",
    });
    const bedroom = item({
      id: "bedroom",
      title: "Покрывало «Софт»",
      quantity: 1,
      originalUnitPrice: 8703,
      unitPrice: 8800,
      room: "bedroom",
      configuration: {
        ...emptyConfiguration(),
        stitch: "Ромб 10×10",
        explanation:
          "Использована подтверждённая стёжка модели «Ромб 10×10», 150 ₽/м².",
      },
    });
    const proposal = {
      ...emptyProposal(),
      recipient: "Клиент Ромашка",
      author: "Мария",
      objectName: "ЖК Сад, кв. 12",
      issuedOn: "2026-10-30",
      items: [assumed, curtains, delivery, bedroom],
      rooms: [
        { id: "living", name: "Гостиная" },
        { id: "empty", name: "Детская" },
        { id: "bedroom", name: "Спальня" },
      ],
    };

    const model = proposalPdfModel(proposal);
    const serialized = JSON.stringify(model);

    expect(model.issuedOnLabel).toBe("30 октября 2026");
    expect(model.sections.map((section) => section.title)).toEqual([
      "Гостиная",
      "Спальня",
      "Другие изделия",
      "Дополнительные услуги",
    ]);
    expect(model.sections[0].lines.map((line) => line.title)).toEqual([
      "Покрывало «Софт»",
    ]);
    expect(model.sections[0].lines[0].amount).toBe(lineAmount(assumed));
    expect(model.sections[0].lines[0].unitPriceLabel).toBe(formatProposalMoney(8800));
    expect(model.sections[0].lines[0].amountLabel).toBe(formatProposalMoney(17600));
    expect(model.sections[0].subtotal).toBe(lineAmount(assumed));
    expect(model.sections[3].lines[0]).toMatchObject({
      title: "Доставка",
      amount: 1600,
      unitPriceLabel: formatProposalMoney(1600),
    });
    expect(model.sections.reduce((sum, section) => sum + section.subtotal, 0)).toBe(
      clientProposalTotal(proposal.items, proposal.roundingStep, proposal.roundingMode),
    );
    expect(model.total).toBe(
      wholeRubles(
        clientProposalTotal(proposal.items, proposal.roundingStep, proposal.roundingMode),
      ),
    );
    expect(model.totalLabel).toBe(formatProposalMoney(model.total));
    expect(model.subtotalLine).toBeNull();
    expect(formatProposalMoney(8800).replace(/\s/g, " ")).toBe("8 800 ₽");
    expect(formatProposalMoney(2300)).not.toContain(",");
    expect(model.sections[0].lines[0].confirmation).toBe(CLIENT_CONFIRMATION_NOTE);
    expect(model.sections[1].lines[0].confirmation).toBeNull();
    expect(model.sections[3].lines[0].fabric).toBeNull();
    expect(model.sections[2].lines[0].dimensions).toBe("130 × 280 см");
    expect(model.sections[2].lines[0].fabric).toBe("Вандер");
    expect(model.sections[0].lines[0].fabric).toBe("Софт");
    expect(clientCharacteristics(curtains)).toEqual([
      { label: "Ткань", value: "Вандер" },
      { label: "Крепление", value: "люверсы" },
    ]);
    expect(clientCharacteristics(assumed)).toEqual([
      { label: "Ткань", value: "Софт" },
      { label: "Стёжка", value: "Хьюго" },
      { label: "Подкладка", value: "Бойл" },
    ]);
    expect(clientPdfDetailLines(curtains)).toEqual([
      "130 × 280 см · Ткань: Вандер",
      "Крепление: люверсы",
    ]);

    proposal.discount = {
      enabled: true,
      kind: "percent",
      value: "10",
      until: "2026-11-01",
    };
    const discounted = proposalPdfModel(proposal);
    const totals = computeProposalTotals(proposal);
    expect(discounted.subtotalLine).toBe(
      `Стоимость изделий и услуг: ${formatProposalMoney(totals.subtotal)}`,
    );
    expect(discounted.discountLine).toBe(
      `Скидка 10%: −${formatProposalMoney(totals.discountAmount)}`,
    );
    expect(discounted.discountUntilLine).toBe(
      "Скидка действует при оплате до 1 ноября 2026",
    );
    expect(discounted.totalCaption).toBe("Итого к оплате");
    expect(discounted.total).toBe(totals.finalTotal);
    expect(
      clientCharacteristics(
        item({
          id: "lined",
          title: "Покрывало",
          productType: "bedspread",
          configuration: {
            ...emptyConfiguration(),
            lining: "Анна",
            stitch: "Ромб 10×10",
            filling: "100 г/м²",
            heading: "люверсы",
          },
        }),
      ),
    ).toEqual([
      { label: "Стёжка", value: "Ромб 10×10" },
      { label: "Подкладка", value: "Анна" },
    ]);
    expect(
      clientCharacteristics(
        item({
          id: "faced",
          title: "Покрывало",
          productType: "bedspread",
          configuration: {
            ...emptyConfiguration(),
            fabricName: "Основа",
            faceFabric: "Софт",
            dayFabric: "Вуаль",
          },
        }),
      ),
    ).toEqual([{ label: "Ткань", value: "Софт" }]);
    expect(serialized).not.toContain("8703");
    expect(serialized).not.toContain("4555");
    expect(serialized).not.toContain("6.25");
    expect(serialized).not.toContain("2.7");
    expect(serialized).not.toContain("BSD-");
    expect(serialized).not.toContain("stitch_tariff_assumed");
    expect(serialized).not.toContain("default_stitch_assumed");
    expect(serialized).not.toContain("базовому тарифу");
    expect(serialized).not.toContain("Детская");
    expect(serialized).toContain(
      "Шторы «Вандер» с очень длинным индивидуальным названием для гостиной",
    );
  });

  it("marks unconfirmed parameters without flagging a confirmed stitch", () => {
    const assumed = item({
      id: "assumed",
      title: "Покрывало",
      configuration: {
        ...emptyConfiguration(),
        explanation:
          "Стёжка «Квадрат 5х5 см», 180 ₽/м², подставлена как default_stitch_assumed: рисунок в карточке не задан.",
      },
    });
    const filling = item({
      id: "filling",
      title: "Покрывало",
      configuration: {
        ...emptyConfiguration(),
        explanation:
          "Синтепон 300 г/м²: отдельного тарифа нет, начислен тариф 200 г/м² дважды.",
      },
    });
    const trim = item({
      id: "trim",
      title: "Плед",
      configuration: {
        ...emptyConfiguration(),
        explanation: "Цена не включает бахрому: отдельного тарифа нет.",
      },
    });
    const confirmed = item({
      id: "confirmed",
      title: "Покрывало",
      configuration: {
        ...emptyConfiguration(),
        explanation:
          "Использована подтверждённая стёжка модели «Квадрат 5х5 см», 180 ₽/м². Вторая стёжка не начислена.",
      },
    });

    expect(itemNeedsConfirmation(assumed)).toBe(true);
    expect(itemNeedsConfirmation(filling)).toBe(true);
    expect(itemNeedsConfirmation(trim)).toBe(true);
    expect(itemNeedsConfirmation(confirmed)).toBe(false);
  });

  it("builds client-facing pdf detail lines from calculation data", () => {
    const curtainWithExtras = item({
      id: "curtain-full",
      title: "Шторы «Вандер»",
      productType: "curtain",
      widthCm: 130,
      heightCm: 280,
      configuration: {
        ...emptyConfiguration(),
        fabricName: "Вандер",
        lining: "Бойл",
        heading: "люверсы",
      },
      components: [
        {
          category: "production",
          name: "Вышивка — Диана",
          cost: 1200,
        },
      ],
    });
    expect(clientPdfDetailLines(curtainWithExtras)).toEqual([
      "130 × 280 см · Ткань: Вандер",
      "Подкладка: Бойл · Крепление: люверсы · Вышивка: Диана",
    ]);

    const curtainPlain = item({
      id: "curtain-plain",
      title: "Шторы",
      productType: "curtain",
      widthCm: 200,
      heightCm: 260,
      configuration: { ...emptyConfiguration(), fabricName: "Вандер" },
    });
    expect(clientPdfDetailLines(curtainPlain)).toEqual([
      "200 × 260 см · Ткань: Вандер",
    ]);

    const bedspreadFull = item({
      id: "bed",
      title: "Покрывало «Ибица»",
      productType: "bedspread",
      widthCm: 230,
      heightCm: 250,
      configuration: {
        ...emptyConfiguration(),
        fabricName: "Ибица",
        stitch: "Квадрат 5×5",
        lining: "Анна",
      },
      components: [
        {
          category: "production",
          name: "Вышивка — Мэри",
          cost: 900,
        },
      ],
    });
    expect(clientPdfDetailLines(bedspreadFull)).toEqual([
      "230 × 250 см · Ткань: Ибица",
      "Стёжка: Квадрат 5×5 · Подкладка: Анна · Вышивка: Мэри",
    ]);

    const bedspreadAssumed = item({
      id: "bed-assumed",
      title: "Покрывало «Софт»",
      productType: "bedspread",
      widthCm: 230,
      heightCm: 250,
      configuration: {
        ...emptyConfiguration(),
        fabricName: "Софт",
        stitch: "Хьюго",
        stitchTariffAssumed: true,
        stitchWarning: technicalWarning,
      },
      components: [
        {
          category: "production",
          name: "Стежка покрывала — Хьюго",
          cost: 864,
          operationId: "BSD-STITCH-Квадрат 5х5 см",
          tariff: 180,
        },
      ],
    });
    expect(clientPdfDetailLines(bedspreadAssumed)[1]).toBe("Стёжка: Хьюго");
    expect(clientPdfDetailLines(bedspreadAssumed).join(" ")).not.toContain("Квадрат");
    expect(itemNeedsConfirmation(bedspreadAssumed)).toBe(true);

    const bedspreadModelEmbroidery = item({
      id: "bed-model-emb",
      title: "Покрывало «Мэри»",
      productType: "bedspread",
      model: "Мэри",
      widthCm: 220,
      heightCm: 240,
      configuration: {
        ...emptyConfiguration(),
        fabricName: "Мэри",
        stitch: "Ромб 10×10",
      },
      components: [
        {
          category: "production",
          name: "Вышивка — Мэри",
          cost: 1200,
        },
      ],
    });
    expect(clientPdfDetailLines(bedspreadModelEmbroidery)[1]).toContain("Вышивка: Мэри");

    const romanStandard = item({
      id: "roman",
      title: "Римская штора",
      productType: "roman",
      widthCm: 165,
      heightCm: 180,
      configuration: {
        ...emptyConfiguration(),
        fabricName: "Вандер",
        lining: "Бойл",
        mechanism: "Стандарт",
      },
    });
    expect(clientPdfDetailLines(romanStandard)).toEqual([
      "165 × 180 см · Ткань: Вандер",
      "Подкладка: Бойл · Механизм: Стандарт",
    ]);

    const romanDayNight = item({
      id: "roman-dn",
      title: "Римская штора",
      productType: "roman",
      widthCm: 165,
      heightCm: 180,
      configuration: {
        ...emptyConfiguration(),
        fabricName: "Вандер",
        dayFabric: "Вуаль",
        mechanism: "День-ночь",
      },
    });
    expect(clientPdfDetailLines(romanDayNight)[1]).toContain("Дневная ткань: Вуаль");

    const modelOnlyEmbroidery = item({
      id: "miriam",
      title: "Покрывало «Мириам»",
      productType: "bedspread",
      model: "Мириам",
      configuration: { ...emptyConfiguration(), fabricName: "Мириам" },
      components: [],
    });
    expect(clientCharacteristics(modelOnlyEmbroidery)).toEqual([
      { label: "Ткань", value: "Мириам" },
    ]);
  });
});
