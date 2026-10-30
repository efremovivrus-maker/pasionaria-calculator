import { readFileSync, writeFileSync } from "node:fs";
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

type Fixture = {
  id: string;
  offers: string[];
  build: () => ReturnType<typeof emptyProposal>;
};

const fixtures: Fixture[] = [
  {
    id: "bedspread_only",
    offers: ["pillows", "bedding", "curtains", "tulle"],
    build: () => {
      const proposal = {
        ...emptyProposal(new Date("2026-10-30T12:00:00")),
        recipient: "Анна Иванова",
        author: "Менеджер PASIONARIA",
        objectName: "Квартира, Москва",
        rooms: [{ id: "bedroom", name: "Спальня" }],
        items: [
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
        ],
      };
      proposal.cover.offers = ["pillows", "bedding", "curtains", "tulle"] as never;
      return proposal;
    },
  },
  {
    id: "curtains_and_bedspread",
    offers: ["tulle", "bedspread"],
    build: () => {
      const proposal = {
        ...emptyProposal(new Date("2026-10-30T12:00:00")),
        recipient: "Анна Иванова",
        author: "Менеджер PASIONARIA",
        objectName: "Квартира, Москва",
        rooms: [
          { id: "living", name: "Гостиная" },
          { id: "bedroom", name: "Спальня" },
        ],
        items: [
          {
            id: "c",
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
        ],
      };
      proposal.cover.offers = ["tulle", "bedspread"] as never;
      return proposal;
    },
  },
  {
    id: "curtains_mounting_in_kp",
    offers: ["rails"],
    build: () => {
      const proposal = {
        ...emptyProposal(new Date("2026-10-30T12:00:00")),
        recipient: "Анна Иванова",
        author: "Менеджер PASIONARIA",
        objectName: "Квартира, Москва",
        rooms: [{ id: "living", name: "Гостиная" }],
        items: [
          {
            id: "c",
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
            id: "m",
            title: "Монтаж штор",
            itemType: "service" as const,
            productType: null,
            model: null,
            widthCm: null,
            heightCm: null,
            quantity: 1,
            configuration: emptyConfiguration(),
            components: [],
            originalUnitPrice: 3500,
            unitPrice: 3500,
            room: "living",
          },
        ],
      };
      proposal.cover.offers = ["rails"] as never;
      return proposal;
    },
  },
];

describe.skipIf(!live)("live cover message matrix", () => {
  it(
    "writes 3 compositions × 3 tones via YandexGPT",
    async () => {
      const out: Record<string, Record<string, string>> = {};
      for (const fixture of fixtures) {
        out[fixture.id] = {};
        for (const tone of ["warm", "business", "brief"] as const) {
          const proposal = fixture.build();
          proposal.cover.tone = tone;
          const text = await generateCoverMessage(coverMessageInput(proposal));
          expect(text.length).toBeGreaterThan(20);
          out[fixture.id][tone] = text;
        }
      }
      const target = path.join(process.cwd(), "..", "drafts/cover-message-matrix-yandex-live.json");
      writeFileSync(target, JSON.stringify(out, null, 2), "utf8");
    },
    600_000,
  );
});
