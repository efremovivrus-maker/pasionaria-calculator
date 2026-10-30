/** @vitest-environment node */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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
    expect(text).not.toContain("Хьюго");
    expect(text).not.toContain("Бойл");
    expect(text).not.toContain(compact("Стёжка"));
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
          widthCm: 165,
          heightCm: 180,
          quantity: 1,
          originalUnitPrice: 6400,
          unitPrice: 6400,
          room: "living",
          configuration: { ...emptyConfiguration(), fabricName: "Вандер" },
        }),
        item({
          id: "bedspread",
          title: "Покрывало спальни",
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
    expect(documentText).toContain(compact("Ткань: Вандер"));
    expect(documentText).toContain(compact("Ткань: Софт"));
    expect(documentText).not.toContain("люверс");
    expect(documentText).not.toContain(compact("Подкладка"));
    expect(documentText).not.toContain("Ромб");
    expect(documentText).not.toContain("подгиб");
    expect(documentText).not.toContain("лёгкое");
    expect(documentText).not.toContain(compact("потолочный карниз"));
    expect(documentText).toContain(compact(formatProposalMoney(2300)));
    expect(documentText).toContain(compact(formatProposalMoney(4600)));
    expect(documentText).not.toContain("2277");
  });
});
