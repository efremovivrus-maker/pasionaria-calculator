import { describe, expect, it } from "vitest";

import { allCalculationExamples, EXAMPLE_LIBRARY } from "@/lib/exampleLibrary";

const QUICK_EXAMPLES = [
  "Две шторы Вандер 130 × 280",
  "Римская штора Вандер 165 × 180",
  "Покрывало Софт 230 × 250, ромб 10×10",
];

describe("example library", () => {
  it("contains five categories of five unique requests", () => {
    expect(EXAMPLE_LIBRARY).toHaveLength(5);
    const requests = allCalculationExamples().map((example) => example.request);
    expect(requests).toHaveLength(25);
    expect(new Set(requests).size).toBe(25);
    for (const category of EXAMPLE_LIBRARY) {
      expect(category.examples).toHaveLength(5);
    }
    for (const request of QUICK_EXAMPLES) {
      expect(requests).not.toContain(request);
    }
    expect(requests[1]).toBe("Две портьеры «Билли» 130×250 см");
    expect(requests[9]).toContain("матовый черный");
    expect(requests[9]).not.toContain("чёрный");
    expect(requests[12]).toBe("Две римские шторы «Сири» 120×170 см");
    expect(requests[19]).toBe("Покрывало «Прайм» 230×250 см со штатной вышивкой модели");
  });
});
