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
    introduction: "Анна, добрый день!",
    project_summary:
      "Подготовили коммерческое предложение по текстилю для вашей квартиры в Москве — гостиная и спальня. Общая стоимость 15 000 ₽.",
    included_services: "Доставка уже включена в предложение.",
    selected_offers: [
      { id: "mounting", text: "По гостиной можем отдельно рассчитать монтаж и вывес штор." },
      { id: "bedding", text: "Для спальни будем рады подобрать постельное бельё в тон интерьеру." },
    ],
    closing: "Если будет удобно, обсудим детали в ближайшее время. Менеджер PASIONARIA",
  }),
  business: JSON.stringify({
    introduction: "Анна, направляем коммерческое предложение.",
    project_summary:
      "Текстильное оформление квартиры в Москве: гостиная и спальня. Итоговая сумма 15 000 ₽, доставка включена.",
    included_services: "",
    selected_offers: [
      { id: "mounting", text: "Дополнительно рассчитаем монтаж и вывес штор в гостиной." },
      { id: "bedding", text: "Для спальни можем подобрать постельное бельё." },
    ],
    closing: "Готовы ответить на вопросы. Менеджер PASIONARIA",
  }),
  brief: JSON.stringify({
    introduction: "Анна, КП по текстилю готово.",
    project_summary: "Гостиная и спальня, итого 15 000 ₽, доставка включена.",
    included_services: "",
    selected_offers: [
      { id: "mounting", text: "Монтаж штор в гостиной — отдельный расчёт." },
      { id: "bedding", text: "Постельное бельё для спальни — по запросу." },
    ],
    closing: "Менеджер PASIONARIA",
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
