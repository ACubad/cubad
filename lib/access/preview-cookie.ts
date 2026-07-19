import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "cubad_preview";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Return only the capability digest; raw cookie values never leave this server module. */
export async function getPreviewCapabilityHash(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return token && TOKEN_RE.test(token) ? hashToken(token) : null;
}

/** Server-Action-only helper that creates the browser capability when the first unit is chosen. */
export async function ensurePreviewCapabilityHash(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(COOKIE_NAME)?.value;
  if (existing && TOKEN_RE.test(existing)) return hashToken(existing);

  const token = randomBytes(32).toString("base64url");
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
    priority: "medium",
  });
  return hashToken(token);
}
