export async function removeStoredPhotos(
  supabase: {
    storage: {
      from: (bucket: string) => {
        remove: (paths: string[]) => Promise<unknown>;
      };
    };
  },
  saved: unknown,
): Promise<void> {
  const paths = (saved as { removed_paths?: unknown } | null)?.removed_paths;
  if (!Array.isArray(paths)) {
    return;
  }
  const files = paths.filter((path): path is string => typeof path === "string" && path.startsWith("owners/"));
  if (files.length > 0) {
    await supabase.storage.from("proposal-photos").remove(files);
  }
}
