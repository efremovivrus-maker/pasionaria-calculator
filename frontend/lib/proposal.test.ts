import { beforeEach, describe, expect, it } from "vitest";

import type { CalculationResult } from "@/lib/types";

import {
  applyUnitRounding,
  createManualItem,
  createProposalItem,
  emptyProposal,
  itemsInRoom,
  lineAmount,
  loadProposal,
  moveItemWithinRoom,
  parseProposal,
  proposalTotal,
  PROPOSAL_STORAGE_KEY,
  clientLineAmount,
  clientUnitPrice,
  roundToStep,
  saveProposal,
  todayIsoDate,
  unitPriceFromTotal,
  type ProposalItem,
} from "./proposal";

const curtain: CalculationResult = {
  status: "success",
  retailPrice: 10000,
  model: "Вандер",
  productType: "curtain",
  widthCm: 130,
  heightCm: 280,
  quantity: 2,
  fabricName: "Вандер",
  fabricConsumptionM: 6,
  operations: [],
  extras: [],
  components: [
    { category: "fabric", name: "Ткань «Вандер»", cost: 6000 },
  ],
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
  explanation: "Стёжка «Ромб 10×10».",
  operations: [],
  extras: [],
  components: [
    { category: "fabric", name: "Ткань «Софт»", cost: 2673 },
    {
      category: "production",
      name: "Стежка покрывала — Ромб 10х10 см",
      cost: 862.5,
    },
  ],
};

beforeEach(() => {
  sessionStorage.clear();
});

describe("proposal items", () => {
  it("stores the calculator unit price and leaves future fields empty", () => {
    const item = createProposalItem(curtain, {
      normalized_request: {
        product_type: "curtain",
        model: "Вандер",
        width_cm: 130,
        height_cm: 280,
        quantity: 2,
        configuration: { heading: "люверсы" },
        extra_operations: ["подгиб"],
      },
    });

    expect(item.title).toBe("Шторы «Вандер»");
    expect(item.quantity).toBe(2);
    expect(item.originalUnitPrice).toBe(5000);
    expect(item.unitPrice).toBe(5000);
    expect(lineAmount(item)).toBe(10000);
    expect(item.room).toBeNull();
    expect(item.configuration.heading).toBe("люверсы");
    expect(item.configuration.extraOperations).toEqual(["подгиб"]);
    expect(item.components).toHaveLength(1);
    expect(item.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("keeps repeated additions as separate items", () => {
    const payload = {
      normalized_request: {
        configuration: { lining: "Бойл" },
        stitch: "Ромб 10×10",
        filling: "200",
      },
    };
    const first = createProposalItem(bedspread, payload);
    const second = createProposalItem(bedspread, payload);

    expect(first.id).not.toBe(second.id);
    expect(first.title).toBe(second.title);
    expect(first.configuration.lining).toBe("Бойл");
    expect(first.configuration.stitch).toBe("Ромб 10×10");
    expect(first.configuration.filling).toBe("200");
    expect(proposalTotal([first, second])).toBe(17406);
  });

  it("rounds an uneven unit price to kopecks", () => {
    expect(unitPriceFromTotal(10000, 3)).toBe(3333.33);
    expect(lineAmount({ unitPrice: 3333.33, quantity: 3 })).toBe(9999.99);
  });

  it("saves and reloads the proposal without a server", () => {
    const item = createProposalItem(bedspread);
    const proposal = {
      ...emptyProposal(),
      recipient: null,
      author: null,
      items: [item],
    };

    saveProposal(proposal);
    expect(sessionStorage.getItem(PROPOSAL_STORAGE_KEY)).toContain(item.id);
    expect(loadProposal()).toEqual(proposal);
  });

  it("ignores a damaged stored proposal", () => {
    sessionStorage.setItem(PROPOSAL_STORAGE_KEY, "{");
    expect(loadProposal()).toEqual(emptyProposal());
    expect(parseProposal({ items: [{ title: "без id" }] }).items).toEqual([]);
  });
});

describe("proposal rounding and rooms", () => {
  it("rounds the unit price from the original amount", () => {
    expect(roundToStep(8736, 100, "nearest")).toBe(8700);
    expect(roundToStep(8750, 100, "nearest")).toBe(8800);
    expect(roundToStep(8736, 100, "up")).toBe(8800);
    expect(roundToStep(8700, 100, "up")).toBe(8700);
    expect(roundToStep(8736, 10, "nearest")).toBe(8740);
    expect(roundToStep(8736, 1000, "nearest")).toBe(9000);
    expect(roundToStep(1000, 1000, "up")).toBe(1000);
    const source = { originalUnitPrice: 2277.5, unitPrice: 2277.5 };
    expect(clientUnitPrice(source, 100, "nearest")).toBe(2300);
    expect(clientUnitPrice(source, 10, "nearest")).toBe(2280);
    expect(clientUnitPrice(source, 100, "up")).toBe(2300);
    expect(clientLineAmount({ ...source, quantity: 2 }, 100, "nearest")).toBe(4600);
    expect(
      clientUnitPrice({ originalUnitPrice: 8736, unitPrice: 9000 }, 100, "nearest"),
    ).toBe(9000);
    expect(
      clientUnitPrice({ originalUnitPrice: 8736, unitPrice: 8700 }, 10, "nearest"),
    ).toBe(8700);

    const item = pricedItem({
      originalUnitPrice: 8736,
      unitPrice: 9000,
    });
    const nearestHundred = applyUnitRounding([item], 100, "nearest")[0];
    expect(nearestHundred.unitPrice).toBe(8700);
    expect(nearestHundred.originalUnitPrice).toBe(8736);
    const nearestTen = applyUnitRounding([nearestHundred], 10, "nearest")[0];
    expect(nearestTen.unitPrice).toBe(8740);
    expect(nearestTen.originalUnitPrice).toBe(8736);
  });

  it("keeps the same product independent in different rooms and can reorder it", () => {
    const living = { id: "room-living", name: "Гостиная" };
    const bedroom = { id: "room-bedroom", name: "Спальня" };
    const first = pricedItem({ id: "first", room: living.id, title: "Покрывало «Софт»" });
    const second = pricedItem({
      id: "second",
      room: bedroom.id,
      title: "Покрывало «Софт»",
      unitPrice: 9000,
    });
    const third = pricedItem({ id: "third", room: living.id, title: "Доставка" });

    expect(first.id).not.toBe(second.id);
    expect(itemsInRoom([first, second, third], living.id).map((item) => item.id)).toEqual([
      "first",
      "third",
    ]);
    expect(itemsInRoom([first, second, third], null)).toEqual([]);
    expect(
      moveItemWithinRoom([first, second, third], "third", "up").map((item) => item.id),
    ).toEqual(["third", "second", "first"]);
    expect(proposalTotal(itemsInRoom([first, second, third], living.id))).toBe(10000);
  });

  it("reads an older cart and keeps a manual price separate from the original", () => {
    const parsed = parseProposal({
      items: [
        {
          id: "legacy",
          title: "Шторы «Вандер»",
          quantity: 2,
          originalUnitPrice: 2277.5,
          unitPrice: 2277.5,
          room: "Гостиная",
        },
      ],
    });

    expect(parsed.rooms).toEqual([]);
    expect(parsed.items[0].room).toBeNull();
    expect(parsed.roundingStep).toBe(100);
    expect(parsed.roundingMode).toBe("nearest");
    expect(parsed.issuedOn).toBe(todayIsoDate());
    expect(parsed.objectName).toBeNull();

    const manual = createManualItem({
      title: "Доставка",
      quantity: 1,
      unitPrice: 1500,
    });
    expect(manual?.originalUnitPrice).toBe(1500);
    expect(manual?.unitPrice).toBe(1500);
    expect(manual?.itemType).toBe("service");
    expect(lineAmount({ unitPrice: 1600, quantity: manual?.quantity ?? 1 })).toBe(1600);

    const installation = createManualItem({
      title: "Монтаж карниза",
      quantity: 1,
      unitPrice: 2400,
    });
    expect(installation?.itemType).toBe("product");
    expect(installation?.unitPrice).toBe(2400);

    const explicitProduct = createManualItem({
      title: "Доставка",
      quantity: 1,
      unitPrice: 1500,
      itemType: "product",
    });
    expect(explicitProduct?.itemType).toBe("product");
    expect(explicitProduct?.unitPrice).toBe(1500);

    const legacyService = parseProposal({
      items: [
        {
          id: "legacy-delivery",
          title: "Доставка",
          quantity: 1,
          originalUnitPrice: 1600,
          unitPrice: 1600,
        },
        {
          id: "legacy-install",
          title: "Доставка по городу",
          quantity: 1,
          originalUnitPrice: 1800,
          unitPrice: 1800,
        },
      ],
    });
    expect(legacyService.items.map((entry) => entry.itemType)).toEqual([
      "service",
      "product",
    ]);
    expect(legacyService.items[0].unitPrice).toBe(1600);
  });
});

function pricedItem(overrides: Partial<ProposalItem>): ProposalItem {
  return {
    id: "item",
    title: "Позиция",
    productType: null,
    model: null,
    widthCm: null,
    heightCm: null,
    itemType: "product",
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
      fabricName: null,
      fabricConsumptionM: null,
      stitchTariffAssumed: false,
      stitchWarning: null,
      explanation: null,
    },
    components: [],
    originalUnitPrice: 5000,
    unitPrice: 5000,
    room: null,
    ...overrides,
  };
}
