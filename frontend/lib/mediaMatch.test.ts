import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  catalogModelsFor,
  matchProductMedia,
  offersForCalculatorModel,
  offersForExactModel,
  type MediaOffer,
} from "./mediaMatch";

const offers: MediaOffer[] = [
  {
    offer_id: "1",
    model: "Вандер",
    article: null,
    full_article: null,
    color: "Белый",
    cover: "http://pro.pasionaria.ru/a.jpg",
    images: ["http://pro.pasionaria.ru/a.jpg", "http://pro.pasionaria.ru/b.jpg"],
  },
  {
    offer_id: "2",
    model: "Декоративная ткань \"Вандер\"",
    article: null,
    full_article: null,
    color: "Бежевый",
    cover: "http://pro.pasionaria.ru/c.jpg",
    images: ["http://pro.pasionaria.ru/c.jpg"],
  },
];

describe("media catalog matching", () => {
  it("returns only an exact model and keeps every color variant", () => {
    expect(offersForExactModel(offers, "Вандер").map((offer) => offer.offer_id)).toEqual(["1"]);
    expect(offersForExactModel(offers, "Декоративная ткань \"Вандер\"")).toHaveLength(1);
    expect(offersForExactModel(offers, "вандер ткань")).toEqual([]);
  });

  it("uses only a confirmed mapping and otherwise keeps the calculator name", () => {
    expect(catalogModelsFor("Вандер", "curtain", [])).toEqual(["Вандер"]);
    expect(
      catalogModelsFor("Вандер", "curtain", [
        {
          calculatorModel: "Вандер",
          productType: "curtain",
          catalogModel: 'Комплект штор "Вандер"',
        },
        {
          calculatorModel: "Вандер",
          productType: "roman",
          catalogModel: 'Римская штора "Вандер"',
        },
      ]),
    ).toEqual(['Комплект штор "Вандер"']);
    expect(
      offersForCalculatorModel(offers, "Вандер", "curtain", [
        {
          calculatorModel: "Вандер",
          productType: "curtain",
          catalogModel: 'Декоративная ткань "Вандер"',
        },
      ]).map((offer) => offer.offer_id),
    ).toEqual(["2"]);
  });

  it("matches a model inside the product category and ignores fabric", () => {
    const catalog: MediaOffer[] = [
      offer("fabric", 'Декоративная ткань "Вандер"', "Белый"),
      offer("curtains", 'Комплект штор "Вандер"', "Белый"),
      offer("curtains-beige", 'Комплект штор "Вандер"', "Бежевый"),
      offer("roman", 'Римская штора "Вандер"', "Белый"),
      offer("bed", 'Покрывало с наволочками "Софт"', "Серый"),
      offer("set", 'Комплект штор "Джейн"', "Белый"),
      offer("panel", 'Портьера "Джейн"', "Белый"),
      offer("plus", 'Комплект штор "Вандер плюс"', "Белый"),
      offer("spaced", 'Комплект штор  «Бохо +»', "Белый"),
    ];

    const curtains = matchProductMedia(catalog, "вандер", "curtain", null);
    expect(curtains.status).toBe("automatic");
    expect(curtains.offers.map((item) => item.offer_id)).toEqual(["curtains", "curtains-beige"]);

    const white = matchProductMedia(catalog, "Вандер", "curtain", "белый");
    expect(white.offers.map((item) => item.offer_id)).toEqual(["curtains"]);

    const missingColor = matchProductMedia(catalog, "Вандер", "curtain", "Синий");
    expect(missingColor).toMatchObject({ status: "color-missing", offers: [] });
    expect(matchProductMedia(catalog, "Нет модели", "curtain", "Синий").status).toBe("none");

    expect(matchProductMedia(catalog, "Вандер", "roman", null).offers.map((item) => item.offer_id)).toEqual([
      "roman",
    ]);
    expect(matchProductMedia(catalog, "Софт", "bedspread", null).groups[0].category).toBe(
      "Покрывало с наволочками",
    );
    expect(matchProductMedia(catalog, "Джейн", "curtain", null).status).toBe("ambiguous");
    expect(matchProductMedia(catalog, "Вандер", "bedspread", null).status).toBe("none");
    expect(matchProductMedia(catalog, "Вандер", "curtain", null).offers.map((item) => item.offer_id)).not.toContain(
      "plus",
    );
    expect(matchProductMedia(catalog, "Бохо +", "curtain", null).offers.map((item) => item.offer_id)).toEqual([
      "spaced",
    ]);
  });

  it("matches the published catalog by product category", () => {
    const root = path.join(process.cwd(), "..");
    const catalog = JSON.parse(
      readFileSync(path.join(root, "data/media/pasionaria_media_catalog_2026-11-03.json"), "utf8"),
    ) as { offers: MediaOffer[] };
    const report = JSON.parse(
      readFileSync(path.join(root, "data/media/model-match-report.json"), "utf8"),
    ) as {
      byProductType: Record<string, { automatic: number; ambiguous: number; notFound: number }>;
    };
    const master = JSON.parse(
      readFileSync(path.join(root, "backend/app/data/master.json"), "utf8"),
    ) as { records: Array<{ model?: string }> };
    const models = [...new Set(master.records.map((record) => record.model).filter(Boolean))] as string[];
    expect(models).toHaveLength(110);

    const offers = catalog.offers.flatMap((item) =>
      item && typeof item.offer_id === "string" && typeof item.model === "string"
        ? [
            {
              offer_id: item.offer_id,
              model: item.model,
              article: null,
              full_article: null,
              color: typeof item.color === "string" ? item.color : null,
              cover: null,
              images: [],
            },
          ]
        : [],
    );

    for (const productType of ["curtain", "roman", "bedspread"] as const) {
      const counts = { automatic: 0, ambiguous: 0, none: 0, "color-missing": 0 };
      for (const model of models) {
        counts[matchProductMedia(offers, model, productType, null).status] += 1;
      }
      expect(counts.automatic).toBe(report.byProductType[productType].automatic);
      expect(counts.ambiguous).toBe(report.byProductType[productType].ambiguous);
      expect(counts.none).toBe(report.byProductType[productType].notFound);
    }

    const vanderCurtains = matchProductMedia(offers, "Вандер", "curtain", null);
    expect(vanderCurtains.status).toBe("automatic");
    expect(vanderCurtains.groups.map((group) => group.category)).toEqual(["Комплект штор"]);
    expect(vanderCurtains.offers.some((item) => item.model.includes("Декоративная ткань"))).toBe(false);

    const vanderRoman = matchProductMedia(offers, "Вандер", "roman", "Коричневый");
    expect(vanderRoman.status).toBe("automatic");
    expect(vanderRoman.offers.every((item) => item.color === "Коричневый")).toBe(true);
    expect(matchProductMedia(offers, "Вандер", "roman", "Нет такого цвета").status).toBe("color-missing");

    expect(matchProductMedia(offers, "Софт", "bedspread", null).groups[0]?.category).toBe(
      "Покрывало с наволочками",
    );
    expect(matchProductMedia(offers, "Джейн", "curtain", null).status).toBe("ambiguous");
    expect(matchProductMedia(offers, "Леви+", "curtain", "Синий").status).toBe("none");
    expect(matchProductMedia(offers, "Леви+", "bedspread", "Синий").status).toBe("none");
  });
});

function offer(id: string, model: string, color: string): MediaOffer {
  return {
    offer_id: id,
    model,
    article: null,
    full_article: null,
    color,
    cover: `http://pro.pasionaria.ru/${id}.jpg`,
    images: [`http://pro.pasionaria.ru/${id}.jpg`],
  };
}
