const avatarBucketName = "avatars";

export function resolvePublicAvatarUrl(
  avatarUrl: string | null | undefined,
  supabaseUrl = getDefaultSupabaseUrl()
): string | null {
  const value = avatarUrl?.trim();
  if (!value) return null;

  if (/^(https?:|data:image\/|blob:)/i.test(value) || value.startsWith("/")) {
    return value;
  }

  const avatarPath = value.replace(/^avatars\//i, "").replace(/^\/+/, "");
  if (!avatarPath) return null;
  if (!supabaseUrl) return avatarPath;

  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${avatarBucketName}/${encodeStoragePath(avatarPath)}`;
}

function getDefaultSupabaseUrl(): string | undefined {
  return typeof import.meta.env?.VITE_SUPABASE_URL === "string" ? import.meta.env.VITE_SUPABASE_URL : undefined;
}

function encodeStoragePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
