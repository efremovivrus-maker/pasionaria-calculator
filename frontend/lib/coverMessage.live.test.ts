import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { coverMessageInput } from "@/lib/coverMessage";
import { generateCoverMessage } from "@/lib/yandexGpt";
import { emptyConfiguration, emptyProposal } from "@/lib/proposal";

function loadYandexEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx);
      const value = trimmed.slice(idx + 1).trim();
      if (key.startsWith("YANDEX_GPT_") && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore
  }
}

loadYandexEnv();

const live = Boolean(process.env.YANDEX_GPT_API_KEY && process.env.YANDEX_GPT_FOLDER_ID);

function annaProposal(offers: string[], tone: "warm" | "business" | "brief") {
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
  proposal.cover.offers = offers as never;
  proposal.cover.tone = tone;
  return proposal;
}

describe.skipIf(!live)("live YandexGPT cover messages", () => {
  it(
    "generates three tones for the same KP without item specs",
    async () => {
      const texts: Record<string, string> = {};
      for (const tone of ["warm", "business", "brief"] as const) {
        const proposal = annaProposal(["mounting", "bedding"], tone);
        texts[tone] = await generateCoverMessage(coverMessageInput(proposal));
      }
      for (const text of Object.values(texts)) {
        expect(text).toMatch(/15\s*000|15000/i);
        expect(text).not.toMatch(/\d+\s*[×xх]\s*\d+/u);
        expect(text).not.toContain("Вандер");
        expect(text).not.toContain("Софт");
        expect(text.toLocaleLowerCase("ru")).toContain("монтаж");
        expect(text.toLocaleLowerCase("ru")).toMatch(/постельн|бель/);
        expect(text.toLocaleLowerCase("ru")).toMatch(/доставк/);
      }
      expect(texts.warm.length).toBeGreaterThan(texts.brief.length);
      expect(texts.business).not.toEqual(texts.warm);
    },
    120_000,
  );

  it(
    "includes discount terms without recalculating the total",
    async () => {
      const proposal = annaProposal(["discount"], "warm");
      proposal.cover.discountValue = "10";
      proposal.cover.discountUntil = "2026-10-31";
      const text = await generateCoverMessage(coverMessageInput(proposal));
      expect(text).toContain("10%");
      expect(text).toMatch(/31\s*октябр/i);
      expect(text).not.toMatch(/29\s*160|29160/);
    },
    60_000,
  );
});
