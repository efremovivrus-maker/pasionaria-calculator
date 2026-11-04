import { readFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

function readNames(file: string): string[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

export async function GET() {
  const local = path.join(process.cwd(), "data", "fabric-names.json");
  try {
    return Response.json({ names: readNames(local) });
  } catch {
    return Response.json({ names: [] }, { status: 503 });
  }
}
