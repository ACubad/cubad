import { createHash } from "node:crypto";

/**
 * Legacy passcode -> sync row id. MUST match app/api/sync/route.ts `rowId`
 * exactly: sha256("cubad:" + code.trim()) as lowercase hex. Do not normalize
 * case — the legacy rows were keyed on the passcode as typed.
 */
export function legacyRowId(code: string): string {
  return createHash("sha256").update(`cubad:${code.trim()}`).digest("hex");
}
