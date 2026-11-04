export type MediaOffer = {
  offer_id: string;
  model: string;
  article: string | null;
  full_article: string | null;
  color: string | null;
  cover: string | null;
  images: string[];
};

export function exactModelKey(value: string): string {
  return value.trim().toLocaleLowerCase("ru");
}

/**
 * One card per product category, model and color.
 *
 * Stable rule: offers are scanned in catalog order. The first offer for a
 * category + model + color is kept. Its cover is the first XML picture.
 * Later SKUs of the same combination and the remaining pictures are dropped.
 * Color comparison uses normalizeColorName; the kept offer still carries the
 * catalog's original color spelling.
 */
export function dedupeMediaOffers(offers: MediaOffer[]): MediaOffer[] {
  const groups = new Map<string, MediaOffer>();
  for (const offer of offers) {
    const parsed = parseCatalogTitle(offer.model);
    const category = parsed ? normalizeMediaName(parsed.category) : normalizeMediaName(offer.model);
    const modelName = parsed ? normalizeMediaName(parsed.name) : "";
    const color = offer.color ? normalizeColorName(offer.color) : "";
    const key = `${category}\n${modelName}\n${color}`;
    if (groups.has(key)) {
      continue;
    }
    const cover = offer.cover || offer.images.find((image) => image) || null;
    groups.set(key, {
      ...offer,
      cover,
      images: cover ? [cover] : [],
    });
  }
  return [...groups.values()];
}

export function offersForExactModel(offers: MediaOffer[], model: string): MediaOffer[] {
  const key = exactModelKey(model);
  if (!key) {
    return [];
  }
  return offers.filter((offer) => exactModelKey(offer.model) === key);
}

export type ModelMediaMapEntry = {
  calculatorModel: string;
  productType: "curtain" | "roman" | "bedspread" | null;
  catalogModel: string;
};

/** Confirmed rows only. Without a row, lookup stays an exact catalog model name. */
export function catalogModelsFor(
  calculatorModel: string,
  productType: string | null,
  entries: ModelMediaMapEntry[],
): string[] {
  const key = exactModelKey(calculatorModel);
  if (!key) {
    return [];
  }
  const confirmed = entries.filter(
    (entry) =>
      exactModelKey(entry.calculatorModel) === key &&
      (entry.productType === null || entry.productType === productType),
  );
  const names = [
    ...new Set(confirmed.map((entry) => entry.catalogModel.trim()).filter(Boolean)),
  ];
  return names.length > 0 ? names : [calculatorModel.trim()];
}

export const PRODUCT_MEDIA_CATEGORIES = {
  curtain: [
    "комплект штор",
    "комплект штор с подхватами",
    "портьера",
    "негорючая портьера",
    "блэкаут шторы с подхватами",
  ],
  roman: ["римская штора", "римская штора блэкаут"],
  bedspread: ["покрывало", "покрывало с наволочками"],
} as const;

export type MediaProductType = keyof typeof PRODUCT_MEDIA_CATEGORIES;

export type MediaMatchStatus = "automatic" | "ambiguous" | "none" | "color-missing";

export type MediaMatchGroup = {
  category: string;
  offers: MediaOffer[];
};

export type MediaMatch = {
  status: MediaMatchStatus;
  groups: MediaMatchGroup[];
  offers: MediaOffer[];
};

export function normalizeMediaName(value: string): string {
  return value
    .replace(/[«»“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru");
}

/** Color comparison only. Model and category matching stay on normalizeMediaName. */
export function normalizeColorName(value: string): string {
  return normalizeMediaName(value.normalize("NFC")).replaceAll("ё", "е");
}

export function uniqueColorLabels(colors: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const color of colors) {
    const label = color?.trim();
    if (!label) {
      continue;
    }
    const key = normalizeColorName(label);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

export function catalogColorLabel(value: string, colors: readonly string[]): string | null {
  const key = normalizeColorName(value);
  if (!key) {
    return null;
  }
  return colors.find((color) => normalizeColorName(color) === key) ?? null;
}

export function parseCatalogTitle(model: string): { category: string; name: string } | null {
  const compact = model.trim().replace(/\s+/g, " ");
  const match = /^(.*)\s+[«"]([^»"]+)[»"]$/.exec(compact);
  if (!match) {
    return null;
  }
  const category = match[1].trim();
  const name = match[2].trim();
  if (!category || !name) {
    return null;
  }
  return { category, name };
}

export function matchProductMedia(
  offers: MediaOffer[],
  calculatorModel: string,
  productType: string | null,
  color: string | null = null,
): MediaMatch {
  const empty = { status: "none" as const, groups: [], offers: [] };
  if (!productType || !(productType in PRODUCT_MEDIA_CATEGORIES)) {
    return empty;
  }
  const allowed = new Set(
    PRODUCT_MEDIA_CATEGORIES[productType as MediaProductType].map((category) =>
      normalizeMediaName(category),
    ),
  );
  const modelKey = normalizeMediaName(calculatorModel);
  if (!modelKey) {
    return empty;
  }
  const grouped = new Map<string, MediaOffer[]>();
  for (const offer of offers) {
    const parsed = parseCatalogTitle(offer.model);
    if (!parsed) {
      continue;
    }
    if (normalizeMediaName(parsed.name) !== modelKey) {
      continue;
    }
    if (!allowed.has(normalizeMediaName(parsed.category))) {
      continue;
    }
    const bucket = grouped.get(parsed.category) ?? [];
    bucket.push(offer);
    grouped.set(parsed.category, bucket);
  }
  let groups = [...grouped.entries()].map(([category, groupOffers]) => ({
    category,
    offers: groupOffers,
  }));
  if (groups.length === 0) {
    return empty;
  }
  const colorKey = color?.trim() ? normalizeColorName(color) : "";
  if (colorKey) {
    groups = groups
      .map((group) => ({
        ...group,
        offers: group.offers.filter(
          (offer) => offer.color !== null && normalizeColorName(offer.color) === colorKey,
        ),
      }))
      .filter((group) => group.offers.length > 0);
    if (groups.length === 0) {
      return { status: "color-missing", groups: [], offers: [] };
    }
  }
  const visible = groups.flatMap((group) => group.offers);
  if (groups.length === 1) {
    return { status: "automatic", groups, offers: visible };
  }
  if (groups.length > 1) {
    return { status: "ambiguous", groups, offers: visible };
  }
  return empty;
}

export function offersForCalculatorModel(
  offers: MediaOffer[],
  calculatorModel: string,
  productType: string | null,
  entries: ModelMediaMapEntry[],
): MediaOffer[] {
  const names = catalogModelsFor(calculatorModel, productType, entries);
  const seen = new Set<string>();
  const matched: MediaOffer[] = [];
  for (const name of names) {
    for (const offer of offersForExactModel(offers, name)) {
      if (seen.has(offer.offer_id)) {
        continue;
      }
      seen.add(offer.offer_id);
      matched.push(offer);
    }
  }
  return matched;
}
