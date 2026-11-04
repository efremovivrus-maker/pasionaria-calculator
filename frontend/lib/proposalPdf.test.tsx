/** @vitest-environment node */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Font, renderToBuffer } from "@react-pdf/renderer";
import { beforeAll, describe, expect, it } from "vitest";

import {
  clientUnitPrice,
  emptyConfiguration,
  emptyProposal,
  type ProposalItem,
} from "@/lib/proposal";

import { CLIENT_CONFIRMATION_NOTE, formatProposalMoney } from "./proposalDocument";
import { ProposalPdfDocument } from "./proposalPdf";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fonts = path.join(root, "frontend/public/fonts");

beforeAll(() => {
  Font.register({
    family: "ProposalSans",
    fonts: [
      { src: path.join(fonts, "SourceSans3-Regular.otf"), fontWeight: 400 },
      { src: path.join(fonts, "SourceSans3-Semibold.otf"), fontWeight: 600 },
    ],
  });
  Font.register({
    family: "ProposalSerif",
    src: path.join(fonts, "SourceSerif4-Regular.otf"),
  });
  Font.registerHyphenationCallback((word) => [word]);
});

function item(
  overrides: Partial<ProposalItem> & Pick<ProposalItem, "id" | "title">,
): ProposalItem {
  return {
    itemType: "product",
    productType: null,
    model: null,
    widthCm: null,
    heightCm: null,
    quantity: 1,
    components: [],
    originalUnitPrice: 1000,
    unitPrice: 1000,
    room: null,
    fabricColor: null,
    fabricColorCustom: false,
    mediaOfferId: null,
    mediaImageUrl: null,
    sessionPhotoId: null,
    ...overrides,
    configuration: {
      ...emptyConfiguration(),
      ...overrides.configuration,
    },
  };
}

function pagesOf(pdf: Buffer): string[] {
  const file = path.join(tmpdir(), `pasionaria-kp-${process.pid}.pdf`);
  writeFileSync(file, pdf);
  const python = path.join(root, ".venv/bin/python");
  const output = execFileSync(
    python,
    [
      "-c",
      [
        "import json, sys",
        "from pypdf import PdfReader",
        "reader = PdfReader(sys.argv[1])",
        "json.dump([(page.extract_text() or '') for page in reader.pages], sys.stdout, ensure_ascii=False)",
      ].join("\n"),
      file,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as string[];
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function pagesContaining(pages: string[], needle: string): number[] {
  const target = compact(needle);
  return pages.flatMap((page, index) =>
    compact(page).includes(target) ? [index] : [],
  );
}

describe("proposal pdf", () => {
  it("renders a multipage Russian document from final prices", async () => {
    const livingItems = [
      item({
        id: "soft",
        title: "Покрывало «Софт»",
        productType: "bedspread",
        widthCm: 230,
        heightCm: 250,
        quantity: 2,
        originalUnitPrice: 8703,
        unitPrice: 8800,
        room: "living",
        configuration: {
          ...emptyConfiguration(),
          fabricName: "Софт",
          stitch: "Хьюго",
          lining: "Бойл",
          fabricConsumptionM: 6.25,
          stitchTariffAssumed: true,
          stitchWarning:
            "Тариф стёжки „Хьюго“ отсутствует в справочнике. Стоимость рассчитана по базовому тарифу 180 ₽/м² и требует подтверждения",
        },
        components: [
          {
            category: "production",
            name: "Стежка покрывала — Хьюго",
            cost: 864,
            operationId: "BSD-STITCH-Квадрат 5х5 см",
            tariff: 180,
          },
        ],
      }),
      ...Array.from({ length: 14 }, (_, index) => {
        const number = index + 2;
        return item({
          id: `line-${number}`,
          title: `Позиция ${String(number).padStart(2, "0")} длинное название изделия для переноса коммерческого предложения`,
          quantity: 1,
          originalUnitPrice: 4000 + number * 100,
          unitPrice: 4000 + number * 100,
          room: "living",
          configuration: {
            ...emptyConfiguration(),
            heading: "индивидуальный расчёт с длинной характеристикой изделия",
            mounting: "потолочное крепление",
          },
        });
      }),
    ];
    const proposal = {
      ...emptyProposal(),
      recipient: "Клиент Ромашка",
      author: "Мария",
      objectName: "ЖК Сад, кв. 12",
      issuedOn: "2026-10-30",
      rooms: [
        { id: "living", name: "Гостиная" },
        { id: "empty", name: "Детская" },
        { id: "bedroom", name: "Спальня" },
      ],
      items: [
        ...livingItems,
        item({
          id: "mirror",
          title: "Зеркало",
          quantity: 1,
          originalUnitPrice: 2100,
          unitPrice: 2100,
        }),
        item({
          id: "delivery",
          title: "Доставка",
          itemType: "service",
          quantity: 1,
          originalUnitPrice: 1550,
          unitPrice: 1550,
          room: "living",
        }),
        item({
          id: "rail",
          title: "Карниз спальни",
          quantity: 1,
          originalUnitPrice: 6400,
          unitPrice: 6400,
          room: "bedroom",
        }),
      ],
    };

    const pdf = await renderToBuffer(<ProposalPdfDocument proposal={proposal} />);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = pagesOf(pdf);
    const text = compact(pages.join("\n"));

    expect(pages.length).toBeGreaterThan(1);
    expect(text).toContain(compact("Коммерческое предложение"));
    expect(text).toContain(compact("30 октября 2026"));
    expect(text).toContain(compact("Клиент Ромашка"));
    expect(text).toContain(compact("Мария"));
    expect(text).toContain(compact("ЖК Сад, кв. 12"));
    expect(text).toContain(compact("Покрывало «Софт»"));
    expect(text).toContain(compact("Ткань: Софт"));
    expect(text).toContain(compact("Стёжка: Хьюго"));
    expect(text).toContain(compact("Подкладка: Бойл"));
    expect(text).not.toContain("люверс");
    expect(text).toContain(compact(CLIENT_CONFIRMATION_NOTE));
    expect(text).toContain(compact(formatProposalMoney(17600)));
    expect(text).toContain(compact(formatProposalMoney(1600)));
    expect(text).not.toMatch(/,\d(?!\d)/);
    expect(text).toContain("₽");
    expect(text).not.toContain("8703");
    expect(text).not.toContain("6.25");
    expect(text).not.toContain("6,25");
    expect(text).not.toContain("BSD-STITCH");
    expect(text).not.toContain("stitch_tariff_assumed");
    expect(text).not.toContain("базовомутарифу");
    expect(text).not.toContain("Детская");
    expect(text).not.toContain("Без помещения");
    expect(compact(text).toLocaleLowerCase("ru")).toContain("вашменеджер");
    expect(compact(text).toLocaleLowerCase("ru")).not.toContain("автор");

    for (const page of pages) {
      expect(compact(page)).toContain("PASIONARIA");
    }
    expect(pagesContaining(pages, "1 /")).toContain(0);

    const roomAnchors: Array<[string, string]> = [
      ["Гостиная", "Покрывало «Софт»"],
      ["Другие изделия", "Зеркало"],
      ["Спальня", "Карниз спальни"],
      ["Дополнительные услуги", "Доставка"],
    ];
    for (const [room, firstItem] of roomAnchors) {
      const itemPages = pagesContaining(pages, firstItem);
      expect(itemPages.length).toBeGreaterThan(0);
      for (const index of itemPages) {
        expect(compact(pages[index])).toContain(compact(room));
      }
    }

    const firstRoomPages = new Set(pagesContaining(pages, "Покрывало «Софт»"));
    for (const line of livingItems) {
      const itemPages = pagesContaining(pages, line.title);
      expect(itemPages.length).toBeGreaterThan(0);
      for (const index of itemPages) {
        expect(compact(pages[index])).toContain("Гостиная");
        if (!firstRoomPages.has(index)) {
          expect(compact(pages[index])).toContain("продолжение");
          expect(compact(pages[index])).toContain("ИЗДЕЛИЕ");
        }
      }
    }

    const pairs: Array<[string, string]> = [
      ["Покрывало «Софт»", formatProposalMoney(17600)],
      ["Доставка", formatProposalMoney(clientUnitPrice(proposal.items.find((entry) => entry.id === "delivery")!, proposal.roundingStep, proposal.roundingMode))],
      ["Зеркало", formatProposalMoney(clientUnitPrice(proposal.items.find((entry) => entry.id === "mirror")!, proposal.roundingStep, proposal.roundingMode))],
      ["Карниз спальни", formatProposalMoney(clientUnitPrice(proposal.items.find((entry) => entry.id === "rail")!, proposal.roundingStep, proposal.roundingMode))],
      ...livingItems.slice(1).map(
        (line) =>
          [
            line.title,
            formatProposalMoney(clientUnitPrice(line, proposal.roundingStep, proposal.roundingMode)),
          ] as [string, string],
      ),
    ];
    for (const [left, right] of pairs) {
      const leftPages = pagesContaining(pages, left);
      const rightPages = pagesContaining(pages, right);
      expect(leftPages.length).toBeGreaterThan(0);
      expect(rightPages).toEqual(leftPages);
    }
  });

  it("keeps a room that fits on the next page together", async () => {
    const proposal = {
      ...emptyProposal(),
      recipient: "Анна Иванова",
      author: "Менеджер PASIONARIA",
      objectName: "Квартира, Москва",
      issuedOn: "2026-10-30",
      rooms: [
        { id: "living", name: "Гостиная" },
        { id: "bedroom", name: "Спальня" },
      ],
      items: [
        item({
          id: "living-curtains",
          title: "Шторы гостиной",
          productType: "curtain",
          widthCm: 130,
          heightCm: 280,
          quantity: 2,
          originalUnitPrice: 2277.5,
          unitPrice: 2277.5,
          room: "living",
          configuration: {
            ...emptyConfiguration(),
            fabricName: "Вандер",
            heading: "люверсы",
          },
        }),
        item({
          id: "tulle",
          title: "Тюль",
          widthCm: 260,
          heightCm: 280,
          quantity: 1,
          originalUnitPrice: 4800,
          unitPrice: 4800,
          room: "living",
        }),
        item({
          id: "roman",
          title: "Римская штора",
          productType: "roman",
          widthCm: 165,
          heightCm: 180,
          quantity: 1,
          originalUnitPrice: 6400,
          unitPrice: 6400,
          room: "living",
          configuration: {
            ...emptyConfiguration(),
            fabricName: "Вандер",
            mechanism: "Стандарт",
          },
        }),
        item({
          id: "bedspread",
          title: "Покрывало спальни",
          productType: "bedspread",
          widthCm: 230,
          heightCm: 250,
          quantity: 1,
          originalUnitPrice: 8800,
          unitPrice: 8800,
          room: "bedroom",
          configuration: {
            ...emptyConfiguration(),
            fabricName: "Софт",
            lining: "Анна",
            stitch: "Ромб 10×10 см",
            filling: "100 г/м² (лёгкое)",
          },
        }),
        item({
          id: "bedroom-curtains",
          title: "Шторы спальни",
          productType: "curtain",
          widthCm: 180,
          heightCm: 270,
          quantity: 2,
          originalUnitPrice: 3100,
          unitPrice: 3100,
          room: "bedroom",
          configuration: {
            ...emptyConfiguration(),
            fabricName: "Вандер",
            heading: "люверсы",
            mounting: "потолочный карниз",
            extraOperations: ["подгиб низа"],
          },
        }),
        item({
          id: "delivery",
          title: "Доставка",
          itemType: "service",
          quantity: 1,
          originalUnitPrice: 1600,
          unitPrice: 1600,
        }),
      ],
    };

    const pages = pagesOf(await renderToBuffer(<ProposalPdfDocument proposal={proposal} />));
    const bedroomPages = pagesContaining(pages, "Покрывало спальни");
    expect(bedroomPages).toEqual(pagesContaining(pages, "Шторы спальни"));
    expect(bedroomPages).toEqual(pagesContaining(pages, "Доставка"));
    expect(bedroomPages).toHaveLength(1);
    const bedroom = compact(pages[bedroomPages[0]]);
    expect(bedroom).toContain("Спальня");
    expect(bedroom).toContain("Дополнительныеуслуги");
    expect(bedroom).toContain("ИТОГО");
    expect(bedroom).not.toContain("продолжение");
    const documentText = compact(pages.join("\n"));
    expect(documentText).toContain(compact("Механизм: Стандарт"));
    expect(documentText).toContain(compact("Ткань: Вандер"));
    expect(documentText).toContain(compact("Ткань: Софт"));
    expect(documentText).toContain(compact("Крепление: люверсы"));
    expect(documentText).toContain(compact("Подкладка: Анна"));
    expect(documentText).toContain(compact("Стёжка: Ромб 10×10 см"));
    expect(documentText).not.toContain("подгиб");
    expect(documentText).not.toContain("лёгкое");
    expect(documentText).not.toContain(compact("потолочный карниз"));
    expect(documentText).not.toContain("100г");
    expect(documentText).toContain(compact(formatProposalMoney(2300)));
    expect(documentText).toContain(compact(formatProposalMoney(4600)));
    expect(documentText).not.toContain("2277");
  });

  it("shows Hugo stitch label and confirmation while hiding fallback tariff name", async () => {
    const proposal = {
      ...emptyProposal(),
      recipient: "Клиент",
      author: "Мария",
      issuedOn: "2026-10-30",
      items: [
        item({
          id: "hugo",
          title: "Покрывало «Софт»",
          productType: "bedspread",
          widthCm: 230,
          heightCm: 250,
          quantity: 1,
          unitPrice: 8800,
          originalUnitPrice: 8736,
          configuration: {
            ...emptyConfiguration(),
            fabricName: "Софт",
            stitch: "Хьюго",
            stitchTariffAssumed: true,
            stitchWarning:
              "Тариф стёжки „Хьюго“ отсутствует в справочнике. Стоимость рассчитана по базовому тарифу 180 ₽/м² и требует подтверждения",
          },
          components: [
            {
              category: "production",
              name: "Стежка покрывала — Хьюго",
              cost: 864,
              operationId: "BSD-STITCH-Квадрат 5х5 см",
            },
          ],
        }),
      ],
    };
    const pages = pagesOf(await renderToBuffer(<ProposalPdfDocument proposal={proposal} />));
    const text = compact(pages.join("\n"));
    expect(text).toContain(compact("Стёжка: Хьюго"));
    expect(text).not.toContain("Квадрат");
    expect(text).not.toContain("BSD-STITCH");
    expect(text).toContain(compact(CLIENT_CONFIRMATION_NOTE));
  });

  it("writes a local sample pdf with three product types for visual review", async () => {
    const proposal = {
      ...emptyProposal(),
      recipient: "Тестовый клиент",
      author: "PASIONARIA",
      objectName: "Образец детализации PDF",
      issuedOn: "2026-10-30",
      items: [
        item({
          id: "curtain",
          title: "Шторы «Вандер»",
          productType: "curtain",
          widthCm: 130,
          heightCm: 280,
          quantity: 2,
          unitPrice: 4600,
          originalUnitPrice: 4555,
          configuration: {
            ...emptyConfiguration(),
            fabricName: "Вандер",
            lining: "Бойл",
            heading: "люверсы",
          },
          components: [
            { category: "production", name: "Вышивка — Диана", cost: 800 },
          ],
        }),
        item({
          id: "bedspread",
          title: "Покрывало «Ибица»",
          productType: "bedspread",
          widthCm: 230,
          heightCm: 250,
          quantity: 1,
          unitPrice: 9200,
          originalUnitPrice: 9150,
          configuration: {
            ...emptyConfiguration(),
            fabricName: "Ибица",
            stitch: "Квадрат 5×5",
            lining: "Анна",
          },
          components: [
            { category: "production", name: "Вышивка — Мэри", cost: 650 },
          ],
        }),
        item({
          id: "roman",
          title: "Римская штора «Вандер»",
          productType: "roman",
          widthCm: 165,
          heightCm: 180,
          quantity: 1,
          unitPrice: 6400,
          originalUnitPrice: 6400,
          configuration: {
            ...emptyConfiguration(),
            fabricName: "Вандер",
            dayFabric: "Вуаль",
            mechanism: "День-ночь",
            lining: "Бойл",
          },
        }),
      ],
    };

    const pdf = await renderToBuffer(<ProposalPdfDocument proposal={proposal} />);
    const output = path.join(root, "drafts/pasionaria-kp-pdf-detail-sample.pdf");
    writeFileSync(output, pdf);
    const pages = pagesOf(pdf);
    const text = compact(pages.join("\n"));
    expect(text).toContain(compact("Шторы «Вандер»"));
    expect(text).toContain(compact("Покрывало «Ибица»"));
    expect(text).toContain(compact("Римская штора «Вандер»"));
    expect(text).toContain(compact("Стёжка: Квадрат 5×5"));
    expect(text).toContain(compact("Дневная ткань: Вуаль"));
    expect(text).toContain(compact("Механизм: День-ночь"));
  });

  it("writes a sample pdf with a catalog photo and an uploaded image", async () => {
    const catalog = JSON.parse(
      readFileSync(
        path.join(root, "data/media/pasionaria_media_catalog_2026-11-03.json"),
        "utf8",
      ),
    ) as { offers: Array<{ model: string; cover: string }> };
    const cover = catalog.offers.find((offer) => offer.model === 'Комплект штор "Вандер"')?.cover;
    expect(cover).toMatch(/^https?:\/\/pro\.pasionaria\.ru\//);
    let catalogPhoto =
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==";
    let liveCatalogPhoto = false;
    try {
      const response = await fetch(cover!, { signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        catalogPhoto = `data:image/jpeg;base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
        liveCatalogPhoto = true;
      }
    } catch {
      liveCatalogPhoto = false;
    }
    const uploadedPhoto =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const proposal = {
      ...emptyProposal(),
      recipient: "Проверка фото",
      author: "PASIONARIA",
      issuedOn: "2026-11-04",
      items: [
        item({
          id: "catalog-photo",
          title: "Шторы «Вандер»",
          productType: "curtain",
          model: "Вандер",
          widthCm: 130,
          heightCm: 280,
          quantity: 1,
          unitPrice: 4600,
          originalUnitPrice: 4600,
          mediaImageUrl: catalogPhoto,
          configuration: { ...emptyConfiguration(), fabricName: "Вандер" },
        }),
        item({
          id: "uploaded-photo",
          title: "Покрывало «Софт»",
          productType: "bedspread",
          widthCm: 230,
          heightCm: 250,
          quantity: 1,
          unitPrice: 8800,
          originalUnitPrice: 8800,
          mediaImageUrl: uploadedPhoto,
          configuration: { ...emptyConfiguration(), fabricName: "Софт" },
        }),
      ],
    };
    const pdf = await renderToBuffer(<ProposalPdfDocument proposal={proposal} />);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").split("/Subtype /Image").length - 1).toBeGreaterThanOrEqual(2);
    if (liveCatalogPhoto) {
      writeFileSync(path.join(root, "drafts/pasionaria-kp-photo-sample.pdf"), pdf);
      expect(pdf.length).toBeGreaterThan(20_000);
    } else {
      expect(pdf.length).toBeGreaterThan(1_000);
    }
  }, 20_000);
});
