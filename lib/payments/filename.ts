const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const ALLOWED_MIME = Object.freeze(Object.keys(MIME_EXT));
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

/** Build a safe storage filename from an untrusted browser filename and a validated MIME type. */
export function sanitizeFilename(rawName: string, mime: string): string {
  const ext = MIME_EXT[mime];
  if (!ext) return "";

  const base = (rawName ?? "").split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[^.]+$/, "");
  const cleaned = stem
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);

  return `${cleaned || "proof"}.${ext}`;
}
