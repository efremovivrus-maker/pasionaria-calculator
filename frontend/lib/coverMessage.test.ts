import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COVER_REQUEST_MAX_CHARS,
  composeCoverMessage,
  coverDiscountReady,
  coverMessageBrief,
  coverMessageInput,
  coverPrompt,
  CoverMessageError,
  mergeDraftWithFallbacks,
  messageViolatesSpec,
  missingOfferIds,
  offerInstructions,
  parseCoverMessageDraft,
  parseCoverMessageInput,
  parseCoverRequestBody,
  proposalContentFingerprint,
  relationshipHints,
  selectedOfferInstructions,
} from "@/lib/coverMessage";
import { projectTextileGaps } from "@/lib/coverMessageOffers";
import { generateCoverMessage } from "@/lib/yandexGpt";
import {
  emptyConfiguration,
  emptyCoverMessage,
  emptyProposal,
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
    introduction: "Анна, направляем коммерческое предложение.",
    project_summary: "По текстилю для квартиры в Москве, общая стоимость 4 600 ₽.",
    included_services: "",
    selected_offers: offers,
    closing: "Мария, PASIONARIA",
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

    expect(serialized).toContain("roomsOverview");
    expect(serialized).toContain("total");
    expect(serialized).not.toContain("130 × 280");
    expect(serialized).not.toContain("Вандер");
    expect(serialized).not.toContain("2 300");
    expect(serialized).toContain("Анна Иванова");
  });

  it("lists included services separately from upsells", () => {
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
    const brief = coverMessageBrief(coverMessageInput(proposal));
    expect(brief.includedServicesInProposal).toEqual(["Доставка"]);
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

  it("requires a discount size and keeps the confirmed date", () => {
    const proposal = proposalWith([item({ id: "curtains", title: "Шторы «Вандер»" })]);
    proposal.cover.offers = ["discount"];
    proposal.cover.discountValue = "";
    expect(coverDiscountReady(proposal.cover)).toBe(false);

    proposal.cover.discountValue = "10";
    proposal.cover.discountUntil = "2026-10-31";
    const instruction =
      selectedOfferInstructions(coverMessageInput(proposal)).find((entry) => entry.id === "discount")
        ?.instruction ?? "";
    expect(instruction).toContain("10%");
    expect(instruction).toContain("31 октября 2026");
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
    const draft = parseCoverMessageDraft(modelJson());
    const merged = mergeDraftWithFallbacks(
      draft,
      ["mounting", "discount"],
      [
        { id: "mounting", instruction: "Предложи монтаж." },
        { id: "discount", instruction: "Скидка 10% до 31 октября." },
      ],
    );
    expect(missingOfferIds(merged, ["mounting", "discount"])).toEqual([]);
    expect(composeCoverMessage(merged)).toContain("монтаж");
  });

  it("uses different tone instructions", () => {
    const proposal = proposalWith([item({ id: "curtains", title: "Шторы" })]);
    const base = coverMessageInput(proposal);
    const warm = coverPrompt({ ...base, tone: "warm" });
    const brief = coverPrompt({ ...base, tone: "brief" });
    expect(warm.system).toContain("тёплый");
    expect(brief.system).toContain("краткий");
    expect(brief.system).toMatch(/60\s*слов/);
  });

  it("refuses a discount promise without a size", async () => {
    await expect(
      generateCoverMessage({
        tone: "warm",
        offers: ["discount"],
        discount: null,
        notes: "",
        proposal: coverMessageInput(proposalWith([item({ id: "curtains", title: "Шторы" })])).proposal,
      }),
    ).rejects.toMatchObject({ code: "invalid_discount" });
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

  it("includes tone-specific intro guidance and forbids template openers in prompt", () => {
    const base = coverMessageInput(proposalWith([item({ id: "c", title: "Шторы" })]));
    const warm = coverPrompt({ ...base, tone: "warm" }).system;
    const business = coverPrompt({ ...base, tone: "business" }).system;
    expect(warm).toContain("личное сообщение");
    expect(business).toContain("профессиональное");
    expect(warm).not.toEqual(business);
    expect(warm).toContain("Запрещено начинать");
  });

  it("composes three distinct tone samples from structured drafts", () => {
    const offers = [
      { id: "mounting", text: "Можем отдельно рассчитать монтаж и вывес штор в гостиной." },
      { id: "bedding", text: "Для спальни подберём постельное бельё в тон покрывалу." },
    ];
    const warm = composeCoverMessage({
      introduction: "Анна, добрый день!",
      project_summary:
        "Подготовили коммерческое предложение по текстилю для квартиры в Москве — гостиная и спальня. Общая стоимость 15 000 ₽.",
      included_services: "В предложение уже включена доставка.",
      selected_offers: offers,
      closing: "Будем рады обсудить детали, когда вам удобно. Менеджер PASIONARIA",
    });
    const business = composeCoverMessage({
      introduction: "Анна, направляем коммерческое предложение.",
      project_summary: "Текстиль для квартиры в Москве: гостиная и спальня. Итого 15 000 ₽, доставка включена.",
      included_services: "",
      selected_offers: offers,
      closing: "Готовы ответить на вопросы. Менеджер PASIONARIA",
    });
    const brief = composeCoverMessage({
      introduction: "Анна, КП по текстилю для квартиры готово.",
      project_summary: "Итого 15 000 ₽, доставка включена.",
      included_services: "",
      selected_offers: offers,
      closing: "Менеджер PASIONARIA",
    });
    expect(warm.length).toBeGreaterThan(brief.length);
    expect(business).not.toEqual(warm);
    expect(warm).not.toMatch(/\d+\s*×\s*\d+/);
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
