import { blobToDataUrl } from "@/lib/kpPhotoStore";

export const MAX_INLINE_IMAGE_BYTES = 4_000_000;

export async function imageResponseToDataUrl(response: Response): Promise<string | null> {
  if (!response.ok) {
    return null;
  }
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!type.startsWith("image/")) {
    return null;
  }
  const blob = await response.blob();
  if (blob.size <= 0 || blob.size > MAX_INLINE_IMAGE_BYTES) {
    return null;
  }
  const typed = blob.type ? blob : new Blob([await blob.arrayBuffer()], { type });
  return blobToDataUrl(typed);
}
