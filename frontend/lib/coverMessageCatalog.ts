import type { CoverOfferId } from "@/lib/proposal";

export const COVER_OFFER_GROUPS: Array<{
  title: string;
  options: Array<{ id: CoverOfferId; label: string }>;
}> = [
  {
    title: "Услуги и комплектация",
    options: [
      { id: "mounting", label: "Рассчитать стоимость монтажа и вывеса штор." },
      {
        id: "rails",
        label: "Подобрать и рассчитать карнизы, включая обычные и электрические.",
      },
    ],
  },
  {
    title: "Дополнить интерьер текстилем",
    options: [
      { id: "bedding", label: "Предложить постельное бельё." },
      { id: "kitchen", label: "Предложить кухонный текстиль." },
      { id: "bedspread", label: "Предложить покрывало к шторам." },
      { id: "tulle", label: "Предложить тюль к портьерам." },
      { id: "pillows", label: "Предложить декоративные подушки." },
      {
        id: "curtains",
        label: "Предложить шторы или римские шторы.",
      },
    ],
  },
  {
    title: "Коммерческие предложения",
    options: [
      {
        id: "premium",
        label: "Предложить пересчёт проекта в более дорогом исполнении с премиальными тканями.",
      },
    ],
  },
];

export const COVER_OFFER_LABELS = Object.fromEntries(
  COVER_OFFER_GROUPS.flatMap((group) => group.options.map((option) => [option.id, option.label])),
) as Record<CoverOfferId, string>;

export const COVER_OFFER_ID_SET = new Set<CoverOfferId>(
  COVER_OFFER_GROUPS.flatMap((group) => group.options.map((option) => option.id)),
);
