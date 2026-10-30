import { CoverMessageError, parseCoverRequestBody } from "@/lib/coverMessage";
import { generateCoverMessage } from "@/lib/yandexGpt";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = parseCoverRequestBody(await request.text());
  } catch {
    return Response.json({ error: "unavailable" }, { status: 400 });
  }
  try {
    const text = await generateCoverMessage(body);
    return Response.json({ text });
  } catch (error) {
    if (error instanceof CoverMessageError && error.code === "invalid_discount") {
      return Response.json({ error: "discount" }, { status: 400 });
    }
    if (error instanceof CoverMessageError && error.code === "invalid_request") {
      return Response.json({ error: "unavailable" }, { status: 400 });
    }
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
