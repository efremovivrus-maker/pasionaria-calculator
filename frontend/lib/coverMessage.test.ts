import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildServerFactualBlock,
  COVER_REQUEST_MAX_CHARS,
  proposalIntroPhrase,
  composeCoverMessage,
  buildServerDiscountParagraph,
  coverMessageBrief,
  coverMessageInput,
  coverPrompt,
  CoverMessageError,
  mergeDraftWithFallbacks,
  messageViolatesSpec,
  missingOfferIds,
  offerInstructions,
  offerMentionedTwice,
  parseCoverMessageDraft,
  parseCoverMessageInput,
  parseCoverRequestBody,
  proposalContentFingerprint,
  relationshipHints,
  roomsWithProducts,
  selectedOfferInstructions,
} from "@/lib/coverMessage";
import { projectTextileGaps } from "@/lib/coverMessageOffers";
import { generateCoverMessage } from "@/lib/yandexGpt";
import {
  computeProposalTotals,
  emptyConfiguration,
  emptyCoverMessage,
  emptyProposal,
  proposalDiscountAmount,
  proposalDiscountValid,
  wholeRubles,
  type ProposalItem,
} from "@/lib/proposal";

function item(
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
    originalUnitPrice: 2277.5,
    unitPrice: 2277.5,
    room: "living",
    ...overrides,
    configuration: {
      ...emptyConfiguration(),
      fabricName: "Вандер",
      ...overrides.configuration,
    },
  };
}

function proposalWith(items: ProposalItem[]) {
  return {
    ...emptyProposal(new Date("2026-10-30T12:00:00")),
    recipient: "Анна Иванова",
    author: "Мария",
    objectName: "Квартира, Москва",
    issuedOn: "2026-10-30",
    rooms: [
      { id: "living", name: "Гостиная" },
      { id: "bedroom", name: "Спальня" },
    ],
    items,
  };
}

const modelJson = (offers: Array<{ id: string; text: string }> = []) =>
  JSON.stringify({
    selected_offers: offers,
    closing: "",
  });

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.YANDEX_GPT_API_KEY;
  delete process.env.YANDEX_GPT_FOLDER_ID;
});

describe("cover message", () => {
  it("does not expose line specs in the model brief", () => {
    const proposal = proposalWith([
      item({ id: "curtains", title: "Шторы «Вандер»", quantity: 2 }),
    ]);
    const serialized = JSON.stringify(coverMessageBrief(coverMessageInput(proposal)));

    expect(serialized).not.toContain("roomsOverview");
    expect(serialized).not.toContain('"total"');
    expect(serialized).not.toContain("130 × 280");
    expect(serialized).not.toContain("Вандер");
    expect(serialized).not.toContain("2 300");
    expect(serialized).toContain("requiredOfferIds");
    expect(serialized).toContain("Фактическая часть");
  });

  it("builds factual block with included services on the server", () => {
    const proposal = proposalWith([
      item({ id: "curtains", title: "Шторы «Вандер»" }),
      item({
        id: "delivery",
        title: "Доставка",
        itemType: "service",
        productType: null,
        room: null,
        originalUnitPrice: 1600,
        unitPrice: 1600,
      }),
    ]);
    const input = coverMessageInput(proposal);
    const factual = buildServerFactualBlock(input);
    expect(factual).toMatch(/доставк/i);
    expect(factual).toMatch(/стоимость/i);
  });

  it("omits rooms when no product is assigned to a room", () => {
    const proposal = proposalWith([
      item({ id: "curtains", title: "Шторы «Вандер»", room: null }),
    ]);
    const input = coverMessageInput(proposal);
    expect(roomsWithProducts(input)).toEqual([]);
    const factual = buildServerFactualBlock(input);
    expect(factual).not.toContain("Гостиная");
    expect(factual).not.toContain("Спальня");
    expect(factual).not.toMatch(/помещен/i);
  });

  it("never lists rooms in the server factual block", () => {
    const proposal = proposalWith([
      item({ id: "curtains", title: "Шторы", room: "living" }),
      item({ id: "spread", title: "Покрывало", productType: "bedspread", room: "bedroom" }),
    ]);
    const factual = buildServerFactualBlock(coverMessageInput(proposal));
    expect(roomsWithProducts(coverMessageInput(proposal))).toEqual(["Гостиная", "Спальня"]);
    expect(factual).not.toContain("Гостиная");
    expect(factual).not.toContain("Спальня");
    expect(factual).not.toMatch(/В расчёте/i);
    expect(factual).not.toMatch(/помещен/i);
  });

  it("uses universal textile intro when object name is empty", () => {
    const proposal = proposalWith([item({ id: "curtains", title: "Шторы" })]);
    proposal.objectName = "";
    const input = coverMessageInput(proposal);
    expect(proposalIntroPhrase(input.proposal.objectName)).toBe(
      "Направляем коммерческое предложение по текстильному оформлению.",
    );
    const factual = buildServerFactualBlock(input);
    expect(factual).toMatch(/текстильному оформлению/);
    expect(factual).not.toMatch(/кварти/i);
    expect(factual).not.toMatch(/по объекту/i);
  });

  it("quotes object name without inferring residential type", () => {
    const proposal = proposalWith([item({ id: "curtains", title: "Шторы", room: "living" })]);
    proposal.objectName = "Гостиница «Волга», Казань";
    const factual = buildServerFactualBlock(coverMessageInput(proposal));
    expect(factual).toContain("«Гостиница «Волга», Казань»");
    expect(factual).toMatch(/текстильному оформлению объекта/);
    expect(factual).not.toMatch(/кварти/i);
  });

  it("combines total and a single included service in the intro block", () => {
    const proposal = proposalWith([
      item({ id: "curtains", title: "Шторы" }),
      item({
        id: "delivery",
        title: "Доставка",
        itemType: "service",
        productType: null,
        room: null,
        originalUnitPrice: 1600,
        unitPrice: 1600,
      }),
    ]);
    proposal.objectName = "";
    const factual = buildServerFactualBlock(coverMessageInput(proposal));
    expect(factual).toMatch(/включая доставку/i);
  });

  it("flags residential assumptions from the model unless confirmed in object name", () => {
    const input = coverMessageInput(proposalWith([item({ id: "c", title: "Шторы" })]));
    input.proposal.objectName = "";
    expect(messageViolatesSpec("Рассчитаем шторы для вашей квартиры.", input)).toBe(true);

    input.proposal.objectName = "Квартира, Москва";
    const factual = buildServerFactualBlock(input);
    expect(messageViolatesSpec(factual, input)).toBe(false);
    expect(messageViolatesSpec(`${factual} Уют в вашей квартире.`, input)).toBe(true);
  });

  it("asks to calculate mounting but not rails when mounting is already in the KP", () => {
    const proposal = proposalWith([
      item({ id: "curtains", title: "Шторы «Вандер»", room: "living" }),
      item({
        id: "mount",
        title: "Монтаж штор",
        itemType: "service",
        productType: null,
        room: "living",
        originalUnitPrice: 3000,
        unitPrice: 3000,
      }),
    ]);
    proposal.cover.offers = ["rails"];
    const instructions = selectedOfferInstructions(coverMessageInput(proposal));
    const rails = instructions.find((entry) => entry.id === "rails")?.instruction ?? "";
    expect(rails).toContain("карниз");
    expect(rails).toContain("не входит");
    expect(offerInstructions(coverMessageInput(proposal)).join(" ")).not.toContain("монтаж");
  });

  it("offers bedding and pillows for a bedspread-only bedroom without repeating bedspread", () => {
    const proposal = proposalWith([
      item({
        id: "spread",
        title: "Покрывало «Софт»",
        productType: "bedspread",
        room: "bedroom",
      }),
    ]);
    proposal.cover.offers = ["pillows", "bedding", "curtains"];
    const instructions = selectedOfferInstructions(coverMessageInput(proposal));
    expect(instructions.map((entry) => entry.id)).toEqual(["pillows", "bedding", "curtains"]);
    expect(instructions.find((entry) => entry.id === "bedding")?.instruction).toContain("Спальня");
    expect(instructions.find((entry) => entry.id === "curtains")?.instruction).toContain("Спальня");
  });

  it("does not repeat tulle or bedspread when they already exist", () => {
    const proposal = proposalWith([
      item({ id: "curtains", title: "Шторы «Вандер»", room: "living" }),
      item({ id: "tulle", title: "Тюль", room: "living" }),
      item({
        id: "spread",
        title: "Покрывало «Софт»",
        productType: "bedspread",
        room: "bedroom",
      }),
      item({ id: "bed-curtains", title: "Шторы", room: "bedroom" }),
    ]);
    proposal.cover.offers = ["tulle", "bedspread"];
    const text = selectedOfferInstructions(coverMessageInput(proposal))
      .map((entry) => entry.instruction)
      .join("\n");
    expect(text).toContain("Не предлагай для: Гостиная");
    expect(text).toContain("Не предлагай для: Спальня");
  });

  it("uses proposal discount in the server block, not in upsell offers", () => {
    const proposal = proposalWith([item({ id: "curtains", title: "Шторы «Вандер»" })]);
    proposal.discount = { enabled: true, kind: "percent", value: "10", until: "2026-10-31" };
    const totals = computeProposalTotals(proposal);
    expect(proposalDiscountValid(proposal.discount, totals.subtotal)).toBe(true);
    const input = coverMessageInput(proposal);
    expect(input.proposalDiscount?.amount).toBeGreaterThan(0);
    expect(selectedOfferInstructions(input).map((entry) => entry.id)).not.toContain("discount");
    const factual = buildServerFactualBlock(input);
    expect(factual).toMatch(/Стоимость проекта/i);
    expect(factual).not.toMatch(/Итоговая стоимость/i);
    const discountText = buildServerDiscountParagraph(input);
    expect(discountText).toContain("10%");
    expect(discountText).toContain("31 октября 2026");
    expect(discountText).toMatch(/Итоговая стоимость/i);
    expect(discountText.match(/скидк/giu)?.length).toBe(1);
    const composed = composeCoverMessage(input, {
      selected_offers: [{ id: "mounting", text: "Можем отдельно рассчитать монтаж." }],
      closing: "",
    });
    expect(composed).toMatch(/монтаж/i);
    expect(composed).toContain(discountText);
    expect(composed.split("\n\n").length).toBe(3);
  });

  it("uses structured JSON from Yandex and merges missing offer ids", async () => {
    process.env.YANDEX_GPT_API_KEY = "test-key";
    process.env.YANDEX_GPT_FOLDER_ID = "folder";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { alternatives: [{ message: { text: modelJson([]) } }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { alternatives: [{ message: { text: modelJson([]) } }] },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const proposal = proposalWith([item({ id: "curtains", title: "Шторы «Вандер»" })]);
    proposal.cover.offers = ["mounting", "bedding"];

    const text = await generateCoverMessage(coverMessageInput(proposal));
    expect(text).toContain("монтаж");
    expect(text).toContain("постельн");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("detects forbidden item specs in composed text", () => {
    const input = coverMessageInput(proposalWith([item({ id: "c", title: "Шторы «Вандер»" })]));
    expect(messageViolatesSpec("130 × 280 см", input)).toBe(true);
    expect(messageViolatesSpec("Ткань: Вандер", input)).toBe(true);
    expect(messageViolatesSpec("Общая стоимость 4 600 ₽", input)).toBe(false);
  });

  it("fills missing ids via fallback", () => {
    const input = coverMessageInput(proposalWith([item({ id: "curtains", title: "Шторы «Вандер»" })]));
    const draft = parseCoverMessageDraft(modelJson());
    const merged = mergeDraftWithFallbacks(
      draft,
      ["mounting"],
      [{ id: "mounting", instruction: "Предложи монтаж." }],
      "warm",
    );
    expect(missingOfferIds(merged, ["mounting"])).toEqual([]);
    expect(composeCoverMessage(input, merged)).toContain("монтаж");
  });

  it("uses different tone instructions", () => {
    const proposal = proposalWith([item({ id: "curtains", title: "Шторы" })]);
    const base = coverMessageInput(proposal);
    const warm = coverPrompt({ ...base, tone: "warm" });
    const brief = coverPrompt({ ...base, tone: "brief" });
    expect(warm.system).toContain("тёплый");
    expect(brief.system).toContain("краткий");
    expect(warm.system).toContain("selected_offers");
    expect(brief.system).toMatch(/1–2 коротких предложения/i);
  });

  it("keeps the Yandex call out of the browser module", () => {
    const root = path.resolve(__dirname, "..");
    const shared = readFileSync(path.join(root, "lib/coverMessage.ts"), "utf8");
    const screen = readFileSync(path.join(root, "components/ProposalCoverMessage.tsx"), "utf8");
    expect(shared).not.toContain("YANDEX_GPT_API_KEY");
    expect(shared).not.toContain("llm.api.cloud.yandex.net");
    expect(screen).not.toContain("YANDEX_GPT");
  });

  it("filters relationship hints to selected offers only", () => {
    const proposal = proposalWith([
      item({
        id: "spread",
        title: "Покрывало «Софт»",
        productType: "bedspread",
        room: "bedroom",
      }),
    ]);
    proposal.cover.offers = ["bedding"];
    const hints = relationshipHints(coverMessageInput(proposal));
    expect(hints.some((hint) => /постельн/i.test(hint))).toBe(true);
    expect(hints.some((hint) => /подуш/i.test(hint))).toBe(false);

    proposal.cover.offers = ["pillows"];
    const pillowHints = relationshipHints(coverMessageInput(proposal));
    expect(pillowHints.some((hint) => /подуш/i.test(hint))).toBe(true);
    expect(pillowHints.some((hint) => /постельн/i.test(hint))).toBe(false);

    const gaps = projectTextileGaps(coverMessageInput(proposal));
    expect(gaps.presentCategories).toContain("покрывало");
    expect(gaps.absentCategories).toContain("шторы");
  });

  it("forbids invented rooms in composed messages", () => {
    const input = coverMessageInput(
      proposalWith([item({ id: "spread", title: "Покрывало", productType: "bedspread", room: "bedroom" })]),
    );
    const text = composeCoverMessage(input, {
      selected_offers: [{ id: "bedding", text: "Можем подобрать постельное бельё." }],
      closing: "",
    });
    expect(messageViolatesSpec(`${text} Гостиная`, input)).toBe(true);
    expect(offerMentionedTwice("монтаж штор. монтаж и вывес.", ["mounting"])).toBe(true);
  });

  it("composes three distinct tone samples from server factual + model offers", () => {
    const proposal = proposalWith([
      item({ id: "curtains", title: "Шторы", room: "living" }),
      item({ id: "spread", title: "Покрывало", productType: "bedspread", room: "bedroom" }),
      item({
        id: "delivery",
        title: "Доставка",
        itemType: "service",
        productType: null,
        room: null,
        originalUnitPrice: 1600,
        unitPrice: 1600,
      }),
    ]);
    proposal.cover.offers = ["mounting", "bedding"];
    const offers = [
      { id: "mounting", text: "Можем отдельно рассчитать монтаж и вывес штор." },
      { id: "bedding", text: "Можем подобрать постельное бельё." },
    ];
    const model = { selected_offers: offers, closing: "" };
    const warm = composeCoverMessage({ ...coverMessageInput(proposal), tone: "warm" }, model);
    const business = composeCoverMessage({ ...coverMessageInput(proposal), tone: "business" }, model);
    const brief = composeCoverMessage({ ...coverMessageInput(proposal), tone: "brief" }, model);
    expect(warm.length).toBeGreaterThan(brief.length);
    expect(business).not.toEqual(warm);
    expect(warm).toContain("добрый день!");
    expect(business).toContain("добрый день.");
    expect(warm).not.toMatch(/\d+\s*×\s*\d+/);
    expect(warm).toMatch(/монтаж/i);
    expect(warm).toMatch(/постельн/i);
  });

  it("rejects oversized requests", () => {
    expect(() => parseCoverRequestBody("x".repeat(COVER_REQUEST_MAX_CHARS + 1))).toThrow(
      CoverMessageError,
    );
    const input = coverMessageInput(proposalWith([item({ id: "curtains", title: "Шторы" })]));
    input.proposal.items = Array.from({ length: 81 }, () => input.proposal.items[0]);
    expect(() => parseCoverMessageInput(input)).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
});
