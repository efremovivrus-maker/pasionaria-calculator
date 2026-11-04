import { readFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("fabric")?.trim().toLocaleLowerCase("ru") ?? "";
  const file = path.join(process.cwd(), "..", "backend", "app", "data", "fabrics.json");
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      records?: Array<{ name?: string; colors?: unknown }>;
    };
    const record = (parsed.records ?? []).find(
      (item) => item.name?.trim().toLocaleLowerCase("ru") === name,
    );
    const colors = Array.isArray(record?.colors)
      ? record.colors.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    return Response.json({ colors });
  } catch {
    return Response.json({ colors: [] });
  }
}
