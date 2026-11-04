import { searchMediaByModel } from "@/lib/mediaCatalog.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const model = url.searchParams.get("model")?.trim() ?? "";
  const productType = url.searchParams.get("productType");
  const color = url.searchParams.get("color");
  if (!model) {
    return Response.json({ status: "none", offers: [], colors: [] });
  }
  try {
    const match = searchMediaByModel(model, productType, color);
    return Response.json({
      status: match.status,
      colors: match.colors,
      offers: match.offers.map((offer) => ({
        offerId: offer.offer_id,
        model: offer.model,
        article: offer.article,
        color: offer.color,
        cover: offer.cover,
        images: offer.cover ? [offer.cover] : [],
      })),
    });
  } catch {
    return Response.json(
      { status: "none", offers: [], colors: [], error: "catalog_unavailable" },
      { status: 503 },
    );
  }
}
