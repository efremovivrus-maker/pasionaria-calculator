import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { composeCoverMessage, coverMessageInput } from "@/lib/coverMessage";
import { emptyConfiguration, emptyProposal, type ProposalItem } from "@/lib/proposal";

function product(
  overrides: Partial<ProposalItem> & Pick<ProposalItem, "id" | "title">,
): ProposalItem {
  return {
    itemType: "product",
    productType: "curtain",
    model: null,
    widthCm: 130,
    heightCm: 280,
    quantity: 1,
    components: [],
    originalUnitPrice: 8800,
    unitPrice: 8800,
    room: "bedroom",
    configuration: emptyConfiguration(),
    ...overrides,
  };
}

function baseProposal(items: ProposalItem[]) {
  return {
    ...emptyProposal(new Date("2026-10-30T12:00:00")),
    recipient: "Анна Иванова",
    author: "Менеджер PASIONARIA",
    objectName: "Квартира, Москва",
    issuedOn: "2026-10-30",
    roundingStep: 100 as const,
    roundingMode: "nearest" as const,
    rooms: [
      { id: "living", name: "Гостиная" },
      { id: "bedroom", name: "Спальня" },
    ],
    items,
  };
}

const fixtures = {
  bedspread_only: {
    proposal: baseProposal([
      product({
        id: "spread",
        title: "Покрывало «Софт»",
        productType: "bedspread",
        room: "bedroom",
        originalUnitPrice: 8800,
        unitPrice: 8800,
      }),
    ]),
    offers: ["bedding", "pillows", "curtains", "tulle"] as const,
    model: {
      warm: {
        selected_offers: [
          { id: "bedding", text: "Можем подобрать постельное бельё отдельным расчётом." },
          { id: "pillows", text: "При необходимости подберём декоративные подушки." },
          { id: "curtains", text: "Шторы или римские шторы — отдельный расчёт по запросу." },
          { id: "tulle", text: "Тюль к портьерам можем просчитать отдельно." },
        ],
        closing: "",
      },
      business: {
        selected_offers: [
          { id: "bedding", text: "Дополнительно возможен расчёт постельного белья." },
          { id: "pillows", text: "Возможен расчёт декоративных подушек." },
          { id: "curtains", text: "Шторы или римские шторы — по запросу." },
          { id: "tulle", text: "Тюль — отдельный расчёт." },
        ],
        closing: "",
      },
      brief: {
        selected_offers: [
          { id: "bedding", text: "Бельё — по запросу." },
          { id: "pillows", text: "Подушки — по запросу." },
          { id: "curtains", text: "Шторы — отдельно." },
          { id: "tulle", text: "Тюль — отдельно." },
        ],
        closing: "",
      },
    },
  },
  curtains_and_bedspread: {
    proposal: baseProposal([
      product({ id: "lc", title: "Шторы", room: "living", originalUnitPrice: 6200, unitPrice: 6200 }),
      product({
        id: "spread",
        title: "Покрывало",
        productType: "bedspread",
        room: "bedroom",
        originalUnitPrice: 8800,
        unitPrice: 8800,
      }),
    ]),
    offers: ["tulle", "bedspread"] as const,
    model: {
      warm: {
        selected_offers: [
          { id: "tulle", text: "Можем подобрать тюль к шторам отдельным расчётом." },
          { id: "bedspread", text: "Покрывало для другой зоны — по запросу." },
        ],
        closing: "",
      },
      business: {
        selected_offers: [
          { id: "tulle", text: "Возможен расчёт тюля к шторам." },
          { id: "bedspread", text: "Расчёт покрывала — по запросу." },
        ],
        closing: "",
      },
      brief: {
        selected_offers: [
          { id: "tulle", text: "Тюль — отдельный расчёт." },
          { id: "bedspread", text: "Покрывало — по запросу." },
        ],
        closing: "",
      },
    },
  },
  curtains_mounting_in_kp: {
    proposal: baseProposal([
      product({ id: "lc", title: "Шторы", room: "living", originalUnitPrice: 5100, unitPrice: 5100 }),
      {
        id: "mount",
        title: "Монтаж штор",
        itemType: "service",
        productType: null,
        model: null,
        widthCm: null,
        heightCm: null,
        quantity: 1,
        configuration: emptyConfiguration(),
        components: [],
        originalUnitPrice: 3000,
        unitPrice: 3000,
        room: "living",
      },
    ]),
    offers: ["rails"] as const,
    model: {
      warm: {
        selected_offers: [{ id: "rails", text: "Можем отдельно подобрать и рассчитать карнизы." }],
        closing: "",
      },
      business: {
        selected_offers: [{ id: "rails", text: "Дополнительно возможен расчёт карнизов." }],
        closing: "",
      },
      brief: {
        selected_offers: [{ id: "rails", text: "Карнизы — отдельный расчёт." }],
        closing: "",
      },
    },
  },
};

describe("cover message matrix target samples", () => {
  it("writes composed target messages for 3×3 matrix", () => {
    const out: Record<string, Record<string, string>> = {};
    for (const [fixtureId, fixture] of Object.entries(fixtures)) {
      out[fixtureId] = {};
      for (const tone of ["warm", "business", "brief"] as const) {
        const proposal = { ...fixture.proposal, cover: { ...fixture.proposal.cover, tone, offers: [...fixture.offers] } };
        const input = { ...coverMessageInput(proposal), tone };
        out[fixtureId][tone] = composeCoverMessage(input, fixture.model[tone]);
      }
    }
    const warm = out.bedspread_only.warm;
    const business = out.bedspread_only.business;
    expect(warm).toContain("коммерческое предложение");
    expect(warm).toContain("Спальня");
    expect(warm).not.toContain("Гостиная");
    expect(business).not.toContain("будем рады");
    expect(warm.length).toBeGreaterThan(out.bedspread_only.brief.length);
    expect(out.curtains_mounting_in_kp.warm).toMatch(/монтаж/i);
    const target = path.join(process.cwd(), "..", "drafts/cover-message-matrix-target.json");
    writeFileSync(target, JSON.stringify(out, null, 2), "utf8");
  });
});
