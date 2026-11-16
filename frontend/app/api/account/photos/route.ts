import { photoPath, assertPhotoFile, AccountDenied } from "@/lib/account/rules";
import { accountError, requireAccount } from "@/lib/account/route";

export async function POST(request: Request) {
  const gate = await requireAccount();
  if (!gate.access) {
    return gate.error;
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new AccountDenied("invalid", "Файл не передан.");
    }
    assertPhotoFile({ type: file.type, size: file.size });
    const id = crypto.randomUUID();
    const path = photoPath(gate.access.profile.id, id);
    const uploaded = await gate.access.supabase.storage
      .from("proposal-photos")
      .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
    if (uploaded.error) {
      return accountError(uploaded.error);
    }
    const row = await gate.access.supabase.from("proposal_files").insert({
      id,
      owner_id: gate.access.profile.id,
      storage_path: path,
      content_type: file.type,
      size_bytes: file.size,
    }).select("id").single();
    if (row.error) {
      await gate.access.supabase.storage.from("proposal-photos").remove([path]);
      return accountError(row.error);
    }
    return Response.json({ id });
  } catch (error) {
    return accountError(error);
  }
}
