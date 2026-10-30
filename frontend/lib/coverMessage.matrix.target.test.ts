import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { composeCoverMessage, parseCoverMessageDraft } from "@/lib/coverMessage";

const matrix: Record<string, Record<string, string>> = {
  bedspread_only: {
    warm: JSON.stringify({
      introduction: "Анна, добрый день! Собрали для вас текстиль по спальне.",
      project_summary: "Расчёт по объекту в Москве, одна зона — спальня. Итого 8 800 ₽.",
      included_services: "",
      selected_offers: [
        { id: "bedding", text: "Если захотите дополнить интерьер, можем подобрать постельное бельё в тон покрывалу." },
        { id: "pillows", text: "Также аккуратно подберём декоративные подушки." },
        { id: "curtains", text: "Для гостиной или других комнат можем отдельно рассчитать шторы или римские шторы." },
        { id: "tulle", text: "К будущим шторам при необходимости подберём лёгкий тюль." },
      ],
      closing: "Напишите, когда будет удобно обсудить детали. Менеджер PASIONARIA",
    }),
    business: JSON.stringify({
      introduction: "Анна, добрый день. По вашему объекту в Москве сформирован расчёт текстиля.",
      project_summary: "В расчёте — спальня. Сумма коммерческого предложения: 8 800 ₽.",
      included_services: "",
      selected_offers: [
        { id: "bedding", text: "Дополнительно можем подготовить расчёт постельного белья." },
        { id: "pillows", text: "Возможен расчёт декоративных подушек." },
        { id: "curtains", text: "По запросу — шторы или римские шторы для других помещений." },
        { id: "tulle", text: "Тюль к портьерам — отдельный расчёт." },
      ],
      closing: "Готовы ответить на вопросы. Менеджер PASIONARIA",
    }),
    brief: JSON.stringify({
      introduction: "Анна, расчёт по спальне готов.",
      project_summary: "Итого 8 800 ₽.",
      included_services: "",
      selected_offers: [
        { id: "bedding", text: "Бельё — по запросу." },
        { id: "pillows", text: "Подушки — по запросу." },
        { id: "curtains", text: "Шторы в других зонах — отдельно." },
        { id: "tulle", text: "Тюль — отдельно." },
      ],
      closing: "Менеджер PASIONARIA",
    }),
  },
  curtains_and_bedspread: {
    warm: JSON.stringify({
      introduction: "Здравствуйте, Анна! Завершили расчёт текстиля для вашей квартиры.",
      project_summary: "Гостиная и спальня, общая сумма 15 000 ₽.",
      included_services: "",
      selected_offers: [
        { id: "tulle", text: "В гостиной можем подобрать тюль к шторам в той же гамме." },
        { id: "bedspread", text: "Для гостиной при желании рассчитаем покрывало, если захотите поддержать стиль в другой зоне." },
      ],
      closing: "Будем на связи. Менеджер PASIONARIA",
    }),
    business: JSON.stringify({
      introduction: "Уважаемая Анна, направляем коммерческое предложение по текстилю.",
      project_summary: "Объект: квартира в Москве, зоны — гостиная и спальня. Итоговая сумма 15 000 ₽.",
      included_services: "",
      selected_offers: [
        { id: "tulle", text: "Дополнительно возможен расчёт тюля в гостиной." },
        { id: "bedspread", text: "Расчёт покрывала для гостиной — по запросу." },
      ],
      closing: "Контакты для согласования — в подписи. Менеджер PASIONARIA",
    }),
    brief: JSON.stringify({
      introduction: "Анна, КП по гостиной и спальне.",
      project_summary: "Итого 15 000 ₽.",
      included_services: "",
      selected_offers: [
        { id: "tulle", text: "Тюль в гостиной — отдельный расчёт." },
        { id: "bedspread", text: "Покрывало для гостиной — по запросу." },
      ],
      closing: "Менеджер PASIONARIA",
    }),
  },
  curtains_mounting_in_kp: {
    warm: JSON.stringify({
      introduction: "Анна, делимся расчётом по гостиной — шторы и монтаж уже учтены.",
      project_summary: "Сумма по коммерческому предложению: 8 100 ₽.",
      included_services: "Монтаж штор включён в предложение.",
      selected_offers: [
        { id: "rails", text: "Отдельно можем подобрать и рассчитать карнизы, если это актуально." },
      ],
      closing: "Если появятся вопросы — напишите. Менеджер PASIONARIA",
    }),
    business: JSON.stringify({
      introduction: "Анна, добрый день. Коммерческое предложение по текстилю для гостиной.",
      project_summary: "Итоговая стоимость: 8 100 ₽, монтаж включён.",
      included_services: "В составе КП: монтаж штор.",
      selected_offers: [{ id: "rails", text: "Дополнительно возможен расчёт карнизов." }],
      closing: "Менеджер PASIONARIA",
    }),
    brief: JSON.stringify({
      introduction: "Анна, расчёт по гостиной готов.",
      project_summary: "8 100 ₽, монтаж включён.",
      included_services: "",
      selected_offers: [{ id: "rails", text: "Карнизы — отдельный расчёт." }],
      closing: "Менеджер PASIONARIA",
    }),
  },
};

describe("cover message matrix target samples", () => {
  it("writes composed target messages for 3×3 matrix", () => {
    const out: Record<string, Record<string, string>> = {};
    for (const [fixtureId, tones] of Object.entries(matrix)) {
      out[fixtureId] = {};
      for (const [tone, json] of Object.entries(tones)) {
        out[fixtureId][tone] = composeCoverMessage(parseCoverMessageDraft(json));
      }
    }
    const warm = out.bedspread_only.warm;
    const business = out.bedspread_only.business;
    expect(warm).not.toContain("Подготовили коммерческое предложение");
    expect(business).not.toContain("будем рады");
    expect(warm.length).toBeGreaterThan(out.bedspread_only.brief.length);
    const target = path.join(process.cwd(), "..", "drafts/cover-message-matrix-target.json");
    writeFileSync(target, JSON.stringify(out, null, 2), "utf8");
  });
});
