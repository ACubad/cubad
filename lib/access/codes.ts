import { createHash, randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Generate a one-time plaintext code. Callers must show it once and persist only its hash. */
export function generateCode(): string {
  const bytes = randomBytes(8);
  let body = "";
  for (let index = 0; index < bytes.length; index += 1) {
    body += CROCKFORD[bytes[index] & 31];
  }
  return `CBD-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** Canonical SQL-parity form: uppercase, then strip every non-ASCII alphanumeric. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** SHA-256 hex of the normalized UTF-8 code, matching extensions.digest in redeem_code(). */
export function hashCode(input: string): string {
  return createHash("sha256").update(normalizeCode(input), "utf8").digest("hex");
}
