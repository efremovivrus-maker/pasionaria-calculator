import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COVER_REQUEST_MAX_CHARS,
  coverDiscountReady,
  coverMessageBrief,
  coverMessageInput,
  CoverMessageError,
  offerInstructions,
  parseCoverMessageInput,
  parseCoverRequestBody,
  proposalContentFingerprint,
} from "@/lib/coverMessage";
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
    components: [
      {
        category: "production",
        name: "Стежка",
        cost: 864,
        operationId: "BSD-STITCH",
        tariff: 180,
      },
    ],
    originalUnitPrice: 2277.5,
    unitPrice: 2277.5,
    room: "living",
    ...overrides,
    configuration: {
      ...emptyConfiguration(),
      fabricName: "Вандер",
      heading: "люверсы",
      lining: "Анна",
      stitch: "Хьюго",
      explanation: "stitch_tariff_assumed",
      ...overrides.configuration,
    },
  };
}

function proposalWith(items: ProposalItem[], offers: ProposalItem["title"][] = []) {
  const proposal = {
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
  proposal.cover = {
    ...emptyCoverMessage(new Date("2026-10-30T12:00:00")),
    offers: offers as never,
  };
  return proposal;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.YANDEX_GPT_API_KEY;
  delete process.env.YANDEX_GPT_FOLDER_ID;
});

describe("cover message", () => {
  it("does not ask for extra offers when none are selected", () => {
    const proposal = proposalWith([
      item({ id: "curtains", title: "Шторы «Вандер»", quantity: 2 }),
    ]);
    const input = coverMessageInput(proposal);
    const instructions = offerInstructions(input).join("\n");
    const serialized = JSON.stringify(coverMessageBrief(input));

    expect(instructions).toContain("не выбрал дополнительные предложения");
    expect(serialized).not.toContain("BSD-STITCH");
    expect(serialized).not.toContain("stitch_tariff_assumed");
    expect(serialized).not.toContain("люверсы");
    expect(serialized).not.toContain("Хьюго");
    expect(serialized).not.toContain("864");
    expect(serialized).toContain("Анна Иванова");
    expect(serialized).toContain("Гостиная");
    expect(serialized).toContain("Вандер");
  });

  it("asks to calculate mounting and rails without treating them as included", () => {
    const proposal = proposalWith(
      [item({ id: "curtains", title: "Шторы «Вандер»" })],
      ["mounting", "rails"] as never,
    );
    proposal.cover.offers = ["mounting", "rails"];
    const instructions = offerInstructions(coverMessageInput(proposal)).join("\n");

    expect(instructions).toContain("монтаж и вывес штор");
    expect(instructions).toContain("карнизы");
    expect(instructions).toContain("Гостиная");
    expect(instructions).toContain("не входит в КП");
    expect(instructions).not.toContain("скидк");
  });

  it("offers bedding and a bedspread only where they are missing", () => {
    const proposal = proposalWith([
      item({ id: "living", title: "Шторы «Вандер»", room: "living" }),
      item({
        id: "bedroom-curtains",
        title: "Шторы «Вандер»",
        room: "bedroom",
      }),
      item({
        id: "bedroom-spread",
        title: "Покрывало «Софт»",
        productType: "bedspread",
        room: "bedroom",
        configuration: { ...emptyConfiguration(), fabricName: "Софт" },
      }),
    ]);
    proposal.cover.offers = ["bedding", "bedspread"];
    const instructions = offerInstructions(coverMessageInput(proposal)).join("\n");

    expect(instructions).toContain("постельное бельё");
    expect(instructions).toContain("Спальня");
    expect(instructions).toContain("покрывало");
    expect(instructions).toContain("Гостиная");
    expect(instructions).toContain("Не предлагай для: Спальня");
  });

  it("does not repeat a bedspread that already covers every curtained room", () => {
    const proposal = proposalWith([
      item({
        id: "spread",
        title: "Покрывало «Софт»",
        productType: "bedspread",
        room: "bedroom",
      }),
      item({ id: "curtains", title: "Шторы «Вандер»", room: "bedroom" }),
    ]);
    proposal.cover.offers = ["bedspread"];
    const instructions = offerInstructions(coverMessageInput(proposal)).join("\n");

    expect(instructions).toContain("уже есть");
    expect(instructions).toContain("Не предлагай покрывало повторно");
  });

  it("requires a discount size and keeps the confirmed date", () => {
    const proposal = proposalWith([item({ id: "curtains", title: "Шторы «Вандер»" })]);
    proposal.cover.offers = ["discount"];
    proposal.cover.discountValue = "";
    expect(coverDiscountReady(proposal.cover)).toBe(false);

    proposal.cover.discountKind = "percent";
    proposal.cover.discountValue = "10";
    proposal.cover.discountUntil = "2026-10-31";
    const instructions = offerInstructions(coverMessageInput(proposal)).join("\n");
    expect(instructions).toContain("ровно 10%");
    expect(instructions).toContain("31 октября 2026");
    expect(instructions).toContain("Не пересчитывай сумму");
  });

  it("sends only final prices and forbids invented prices and deadlines", async () => {
    process.env.YANDEX_GPT_API_KEY = "test-key";
    process.env.YANDEX_GPT_FOLDER_ID = "folder";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { alternatives: [{ message: { text: "Готово." } }] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const proposal = proposalWith([
      item({ id: "curtains", title: "Шторы «Вандер»", quantity: 2 }),
    ]);
    proposal.cover.offers = ["premium"];

    await expect(generateCoverMessage(coverMessageInput(proposal))).resolves.toBe("Готово.");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      messages: Array<{ role: string; text: string }>;
      modelUri: string;
      completionOptions: { stream: boolean; temperature: number; maxTokens: string };
    };
    const user = body.messages[1].text;
    const system = body.messages[0].text;

    expect(body.modelUri).toBe("gpt://folder/yandexgpt/latest");
    expect(body.completionOptions).toMatchObject({ stream: false, temperature: 0.4, maxTokens: "900" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Api-Key test-key");
    expect(user.replace(/\s/g, " ")).toContain("2 300 ₽");
    expect(user).not.toContain("2277");
    expect(user).not.toContain("BSD-STITCH");
    expect(system).toContain("придумывать цены");
    expect(system).toContain("сроки изготовления");
    expect(user).toContain("Не называй новую цену");
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

  it("marks the saved message stale when the recipient changes", () => {
    const proposal = proposalWith([item({ id: "curtains", title: "Шторы «Вандер»" })]);
    proposal.cover.text = "Анна, подготовили предложение.";
    proposal.cover.sourceFingerprint = proposalContentFingerprint(proposal);
    expect(proposal.cover.sourceFingerprint).toBe(proposalContentFingerprint(proposal));
    proposal.recipient = "Иван";
    expect(proposalContentFingerprint(proposal)).not.toBe(proposal.cover.sourceFingerprint);
    expect(proposal.cover.text).toBe("Анна, подготовили предложение.");
  });

  it("reports a clear failure when YandexGPT is not configured", async () => {
    await expect(
      generateCoverMessage(coverMessageInput(proposalWith([item({ id: "curtains", title: "Шторы" })]))),
    ).rejects.toMatchObject({ code: "unavailable", message: "unavailable" });
  });

  it("rejects an oversized request and too many items", () => {
    expect(() => parseCoverRequestBody("x".repeat(COVER_REQUEST_MAX_CHARS + 1))).toThrow(
      CoverMessageError,
    );
    expect(() => parseCoverRequestBody("{")).toThrow(CoverMessageError);

    const proposal = coverMessageInput(proposalWith([item({ id: "curtains", title: "Шторы" })]));
    proposal.proposal.items = Array.from({ length: 81 }, () => proposal.proposal.items[0]);
    expect(() => parseCoverMessageInput(proposal)).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });

  it("does not surface an API error body or the key", async () => {
    process.env.YANDEX_GPT_API_KEY = "test-key";
    process.env.YANDEX_GPT_FOLDER_ID = "folder";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Api-Key test-key failed", { status: 401 }),
      ),
    );

    await expect(
      generateCoverMessage(coverMessageInput(proposalWith([item({ id: "curtains", title: "Шторы" })]))),
    ).rejects.toMatchObject({ message: "unavailable" });
  });

  it("keeps the Yandex call out of the browser module", () => {
    const root = path.resolve(__dirname, "..");
    const shared = readFileSync(path.join(root, "lib/coverMessage.ts"), "utf8");
    const screen = readFileSync(path.join(root, "components/ProposalCoverMessage.tsx"), "utf8");
    expect(shared).not.toContain("YANDEX_GPT_API_KEY");
    expect(shared).not.toContain("llm.api.cloud.yandex.net");
    expect(screen).not.toContain("YANDEX_GPT");
    expect(screen).not.toContain("llm.api.cloud.yandex.net");
  });
});
