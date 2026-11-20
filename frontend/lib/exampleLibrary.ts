export type CalculationExample = {
  id: string;
  title: string;
  request: string;
  caption: string;
};

export type ExampleCategory = {
  id: "curtains" | "construction" | "romans" | "bedspreads" | "trims";
  title: string;
  examples: CalculationExample[];
};

export const EXAMPLE_LIBRARY: ExampleCategory[] = [
  {
    id: "curtains",
    title: "Портьеры",
    examples: [
      {
        id: "curtain-soft",
        title: "Портьера Софт",
        request: "Портьера «Софт» 140×260 см",
        caption: "Базовая портьера одного полотна",
      },
      {
        id: "curtain-billy",
        title: "Две портьеры Билли",
        request: "Две портьеры «Билли» 130×250 см",
        caption: "Два изделия одной модели",
      },
      {
        id: "curtain-miriam",
        title: "Портьера Мириам",
        request: "Портьера «Мириам» 140×260 см",
        caption: "Модель и ткань Мириам",
      },
      {
        id: "curtain-prime",
        title: "Две портьеры Прайм",
        request: "Две портьеры «Прайм» 130×250 см",
        caption: "Штатная вышивка модели уже входит в расчёт",
      },
      {
        id: "curtain-tina",
        title: "Портьера Тина",
        request: "Портьера «Тина» 140×270 см",
        caption: "Модель Тина, ткань Софт",
      },
    ],
  },
  {
    id: "construction",
    title: "Крепления, подкладки и вышивка",
    examples: [
      {
        id: "grommet-silver",
        title: "Люверсы, серебро",
        request: "Портьера «Вандер» 140×260 см на люверсах D35 матовое серебро, без слоя",
        caption: "Точный вариант крепления",
      },
      {
        id: "lining-ibiza",
        title: "На подкладке",
        request: "Две портьеры «Ибица» 130×260 см на подкладке",
        caption: "Стандартная подкладка портьеры",
      },
      {
        id: "embroidery-mary",
        title: "Вышивка Мэри",
        request: "Портьера «Мэри» 140×260 см со штатной вышивкой модели",
        caption: "Вышивка модели начисляется один раз",
      },
      {
        id: "tape-soft",
        title: "Шторная лента 4 см",
        request: "Две портьеры «Софт» 130×260 см на шторной ленте 4 см белая, без слоя",
        caption: "Лента 4 см вместо стандартной 6 см",
      },
      {
        id: "grommet-black",
        title: "Люверсы, черный",
        request: "Портьера «Прайм» 140×260 см на люверсах D35 матовый черный, без слоя",
        caption: "Написание «черный» как в справочнике креплений",
      },
    ],
  },
  {
    id: "romans",
    title: "Римские шторы",
    examples: [
      {
        id: "roman-ibiza",
        title: "Римская Ибица",
        request: "Римская штора «Ибица» 150×170 см",
        caption: "Базовая римская штора",
      },
      {
        id: "roman-econom",
        title: "Механизм Эконом",
        request: "Римская штора «Вандер» 120×200 см на механизме Эконом",
        caption: "Механизм вместо стандартного",
      },
      {
        id: "roman-siri",
        title: "Две римские Сири",
        request: "Две римские шторы «Сири» 120×170 см",
        caption: "Две римские шторы",
      },
      {
        id: "roman-day-night",
        title: "День-ночь",
        request: "Римская штора «Мириам» 120×200 см, день-ночь Стандарт, дневная ткань «Вита»",
        caption: "Дневная ткань Вита отдельно от модели",
      },
      {
        id: "roman-salsa",
        title: "Бахрома по низу",
        request: "Римская штора «Вандер» 130×180 см с бахромой «Сальса» по низу",
        caption: "Декоративная бахрома на римской шторе",
      },
    ],
  },
  {
    id: "bedspreads",
    title: "Покрывала",
    examples: [
      {
        id: "bed-anika",
        title: "Квадрат 20×20",
        request: "Покрывало «Аника» 230×250 см, квадрат 20×20",
        caption: "Стёжка и штатная вышивка Аника",
      },
      {
        id: "bed-mary",
        title: "Ромб 10×10",
        request: "Покрывало «Мэри» 200×220 см, ромб 10×10",
        caption: "Вышивка Мэри на подушках в покрывало не входит",
      },
      {
        id: "bed-ibiza",
        title: "Подкладка Бойл",
        request: "Покрывало «Ибица» 230×250 см, подкладка «Бойл»",
        caption: "Подкладка вместо стандартной Анны",
      },
      {
        id: "bed-soft",
        title: "Квадрат 5×5",
        request: "Покрывало «Софт» 230×250 см, квадрат 5×5",
        caption: "Мелкая стёжка",
      },
      {
        id: "bed-prime",
        title: "Вышивка Прайм",
        request: "Покрывало «Прайм» 230×250 см со штатной вышивкой модели",
        caption: "Штатная вышивка начисляется один раз",
      },
    ],
  },
  {
    id: "trims",
    title: "Декоративная фурнитура",
    examples: [
      {
        id: "trim-ribbon",
        title: "Репсовая лента",
        request: "Две портьеры «Софт» 130×261 см с однотонной репсовой лентой серого цвета по двум бокам",
        caption: "Серая лента по двум бокам, не крепление",
      },
      {
        id: "trim-salsa-curtain",
        title: "Бахрома на портьере",
        request: "Портьера «Ибица» 140×260 см с бахромой «Сальса» по низу",
        caption: "Бахрома по нижнему краю",
      },
      {
        id: "trim-salsa-roman",
        title: "Бахрома на римской",
        request: "Римская штора «Вандер» 150×170 см с бахромой «Сальса» по низу",
        caption: "Бахрома по низу римской шторы",
      },
      {
        id: "trim-berries",
        title: "Лента Ягодки",
        request: "Портьера «Мириам» 140×260 см с декоративной лентой «Ягодки», артикул 7388, по низу",
        caption: "Отделка по артикулу",
      },
      {
        id: "trim-piping",
        title: "Кант лён",
        request: "Портьера «Прайм» 140×260 см с кантом «Лён 5 мм», артикул 6008, по двум бокам",
        caption: "Кант по двум бокам",
      },
    ],
  },
];

export function allCalculationExamples(): CalculationExample[] {
  return EXAMPLE_LIBRARY.flatMap((category) => category.examples);
}
