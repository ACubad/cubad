const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const ALLOWED_MIME = Object.freeze(Object.keys(MIME_EXT));
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

/** Match the uploaded bytes to the declared allow-listed MIME type. */
export function proofMagicMatches(bytes: Uint8Array, mime: string): boolean {
  const startsWith = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);

  switch (mime) {
    case "image/jpeg":
      return startsWith(0xff, 0xd8, 0xff);
    case "image/png":
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      return (
        startsWith(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case "application/pdf":
      return startsWith(0x25, 0x50, 0x44, 0x46, 0x2d);
    default:
      return false;
  }
}

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
