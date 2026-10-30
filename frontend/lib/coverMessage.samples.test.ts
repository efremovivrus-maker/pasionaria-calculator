import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { coverMessageInput } from "@/lib/coverMessage";
import { generateCoverMessage } from "@/lib/yandexGpt";
import { emptyConfiguration, emptyProposal } from "@/lib/proposal";

function annaProposal(tone: "warm" | "business" | "brief") {
  const proposal = {
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
    items: [
      {
        id: "lc",
        title: "Шторы «Вандер»",
        itemType: "product" as const,
        productType: "curtain",
        model: null,
        widthCm: 130,
        heightCm: 280,
        quantity: 2,
        configuration: { ...emptyConfiguration(), fabricName: "Вандер" },
        components: [],
        originalUnitPrice: 2277.5,
        unitPrice: 2277.5,
        room: "living",
      },
      {
        id: "bs",
        title: "Покрывало «Софт»",
        itemType: "product" as const,
        productType: "bedspread",
        model: null,
        widthCm: 230,
        heightCm: 250,
        quantity: 1,
        configuration: { ...emptyConfiguration(), fabricName: "Софт" },
        components: [],
        originalUnitPrice: 8800,
        unitPrice: 8800,
        room: "bedroom",
      },
      {
        id: "del",
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
  };
  proposal.cover.offers = ["mounting", "bedding"];
  proposal.cover.tone = tone;
  return proposal;
}

const toneJson: Record<string, string> = {
  warm: JSON.stringify({
    selected_offers: [
      { id: "mounting", text: "Можем отдельно рассчитать монтаж и вывес штор." },
      { id: "bedding", text: "Можем подобрать постельное бельё отдельным расчётом." },
    ],
    closing: "",
  }),
  business: JSON.stringify({
    selected_offers: [
      { id: "mounting", text: "Дополнительно возможен расчёт монтажа и вывеса штор." },
      { id: "bedding", text: "Возможен расчёт постельного белья." },
    ],
    closing: "",
  }),
  brief: JSON.stringify({
    selected_offers: [
      { id: "mounting", text: "Монтаж — отдельный расчёт." },
      { id: "bedding", text: "Постельное бельё — по запросу." },
    ],
    closing: "",
  }),
};

describe.skipIf(!process.env.GENERATE_COVER_SAMPLES)("cover message samples export", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes new-pipeline sample messages", async () => {
    process.env.YANDEX_GPT_API_KEY = "test-key";
    process.env.YANDEX_GPT_FOLDER_ID = "folder";
    const out: Record<string, string> = {};
    for (const tone of ["warm", "business", "brief"] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            result: { alternatives: [{ message: { text: toneJson[tone] } }] },
          }),
        }),
      );
      out[tone] = await generateCoverMessage(coverMessageInput(annaProposal(tone)));
    }
    const target = path.join(process.cwd(), "..", "drafts/cover-message-new-pipeline-samples.json");
    writeFileSync(target, JSON.stringify(out, null, 2), "utf8");
    expect(out.warm.length).toBeGreaterThan(out.brief.length);
  });
});
