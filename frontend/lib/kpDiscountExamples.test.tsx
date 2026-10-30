import { describe, expect, it } from "vitest";

import { composeCoverMessage, coverMessageInput } from "@/lib/coverMessage";
import { proposalPdfModel } from "@/lib/proposalDocument";
import {
  computeProposalTotals,
  emptyConfiguration,
  emptyProposal,
  type CommercialProposal,
} from "@/lib/proposal";

describe("kp discount examples export", () => {
  it("prints pdf summary lines and a composed cover message", async () => {
    const proposal: CommercialProposal = {
      ...emptyProposal(new Date("2026-10-30T12:00:00")),
      recipient: "Анна Иванова",
      author: "Мария",
      objectName: "",
      issuedOn: "2026-10-30",
      items: [
        {
          id: "curtains",
          title: "Шторы «Вандер»",
          itemType: "product" as const,
          productType: "curtain",
          model: null,
          widthCm: 130,
          heightCm: 280,
          quantity: 1,
          configuration: emptyConfiguration(),
          components: [],
          originalUnitPrice: 33600,
          unitPrice: 33600,
          room: "living",
        },
        {
          id: "delivery",
          title: "Доставка",
          itemType: "service" as const,
          productType: null,
          model: null,
          widthCm: null,
          heightCm: null,
          quantity: 1,
          configuration: emptyConfiguration(),
          components: [],
          originalUnitPrice: 1600,
          unitPrice: 1600,
          room: null,
        },
      ],
      rooms: [{ id: "living", name: "Гостиная" }],
      cover: {
        ...emptyProposal().cover,
        tone: "warm" as const,
        offers: ["mounting"],
      },
      discount: {
        enabled: true,
        kind: "percent" as const,
        value: "10",
        until: "2026-11-15",
      },
    };

    const model = proposalPdfModel(proposal);
    const totals = computeProposalTotals(proposal);
    const message = composeCoverMessage(coverMessageInput(proposal), {
      selected_offers: [
        {
          id: "mounting",
          text: "Можем отдельно рассчитать монтаж и вывес штор.",
        },
      ],
      closing: "",
    });

    expect(totals.subtotal).toBe(35200);
    expect(totals.discountAmount).toBe(3520);
    expect(totals.finalTotal).toBe(31680);

    expect(model.subtotalLine).toContain("35");
    expect(model.discountLine).toContain("10%");
    expect(model.totalLabel).toContain("31");
    expect(message).toMatch(/Стоимость проекта — 35[\s\u00a0]*200/);
    expect(message).toMatch(/При оплате до 15 ноября 2026 предоставляем скидку 10%/);
    expect(message).toMatch(/Итоговая стоимость — 31[\s\u00a0]*680/);
    expect(message).toMatch(/монтаж/i);
    expect(message.match(/скидк/giu)?.length).toBe(1);
  });
});
