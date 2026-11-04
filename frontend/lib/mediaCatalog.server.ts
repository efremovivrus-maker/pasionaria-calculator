import { readFileSync } from "node:fs";
import path from "node:path";

import {
  dedupeMediaOffers,
  matchProductMedia,
  type MediaMatch,
  type MediaOffer,
  type ModelMediaMapEntry,
} from "@/lib/mediaMatch";

type CatalogFile = {
  offers?: unknown;
};

let cached: MediaOffer[] | null = null;

function catalogPath(): string {
  return path.join(process.cwd(), "data", "media", "pasionaria_media_catalog_2026-11-03.json");
}

function asOffer(value: unknown): MediaOffer | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Record<string, unknown>;
  const offerId = typeof source.offer_id === "string" ? source.offer_id.trim() : "";
  const model = typeof source.model === "string" ? source.model.trim() : "";
  if (!offerId || !model) {
    return null;
  }
  const images = Array.isArray(source.images)
    ? source.images.filter((item): item is string => typeof item === "string" && item.startsWith("http"))
    : [];
  const cover = typeof source.cover === "string" && source.cover.startsWith("http") ? source.cover : images[0] ?? null;
  return {
    offer_id: offerId,
    model,
    article: typeof source.article === "string" ? source.article : null,
    full_article: typeof source.full_article === "string" ? source.full_article : null,
    color: typeof source.color === "string" ? source.color : null,
    cover,
    images: images.length > 0 ? images : cover ? [cover] : [],
  };
}

export function loadMediaOffers(): MediaOffer[] {
  if (cached) {
    return cached;
  }
  const parsed = JSON.parse(readFileSync(catalogPath(), "utf8")) as CatalogFile;
  const offers = Array.isArray(parsed.offers) ? parsed.offers.flatMap((item) => {
    const offer = asOffer(item);
    return offer ? [offer] : [];
  }) : [];
  cached = offers;
  return offers;
}

function mapPath(): string {
  return path.join(process.cwd(), "data", "model-media-map.json");
}

export function loadModelMediaMap(): ModelMediaMapEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(mapPath(), "utf8")) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const source = item as Record<string, unknown>;
      const calculatorModel =
        typeof source.calculatorModel === "string" ? source.calculatorModel.trim() : "";
      const catalogModel = typeof source.catalogModel === "string" ? source.catalogModel.trim() : "";
      const productType = source.productType;
      if (!calculatorModel || !catalogModel) {
        return [];
      }
      if (
        productType !== null &&
        productType !== "curtain" &&
        productType !== "roman" &&
        productType !== "bedspread"
      ) {
        return [];
      }
      return [{ calculatorModel, productType, catalogModel }];
    });
  } catch {
    return [];
  }
}

export function searchMediaByModel(
  model: string,
  productType: string | null = null,
  color: string | null = null,
): MediaMatch {
  const match = matchProductMedia(loadMediaOffers(), model, productType, color);
  const groups = match.groups.map((group) => ({
    ...group,
    offers: dedupeMediaOffers(group.offers).slice(0, 40),
  }));
  return {
    ...match,
    groups,
    offers: groups.flatMap((group) => group.offers),
  };
}
