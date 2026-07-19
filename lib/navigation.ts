/** Return a same-origin absolute path, rejecting network paths and backslash normalization. */
export function safeNextPath(
  value: string | null | undefined,
  fallback = "/"
): string {
  const candidate = value?.trim();
  if (
    !candidate?.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\r\n\0]/.test(candidate)
  ) {
    return fallback;
  }
  return candidate;
}
