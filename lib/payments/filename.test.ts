import { describe, expect, it } from "vitest";
import {
  ALLOWED_MIME,
  MAX_PROOF_BYTES,
  proofMagicMatches,
  sanitizeFilename,
} from "./filename";

describe("sanitizeFilename", () => {
  it("derives the extension from MIME rather than the client name", () => {
    expect(sanitizeFilename("receipt.exe", "image/jpeg")).toBe("receipt.jpg");
    expect(sanitizeFilename("scan.PDF", "application/pdf")).toBe("scan.pdf");
  });

  it("drops directory traversal and path separators", () => {
    expect(sanitizeFilename("../../etc/passwd", "image/png")).toBe("passwd.png");
    expect(sanitizeFilename("C:\\Users\\a\\proof.jpg", "image/webp")).toBe("proof.webp");
  });

  it("normalizes unsafe runs and trims punctuation", () => {
    expect(sanitizeFilename("  My Receipt (2026)!!.jpg ", "image/jpeg")).toBe(
      "my-receipt-2026.jpg"
    );
  });

  it("falls back when the sanitized stem is empty", () => {
    expect(sanitizeFilename("😀😀😀.png", "image/png")).toBe("proof.png");
    expect(sanitizeFilename("", "application/pdf")).toBe("proof.pdf");
  });

  it("caps the stem length", () => {
    const output = sanitizeFilename(`${"a".repeat(200)}.png`, "image/png");
    expect(output.endsWith(".png")).toBe(true);
    expect(output.length).toBeLessThanOrEqual(64);
  });

  it("rejects disallowed or non-canonical MIME types", () => {
    expect(sanitizeFilename("x.gif", "image/gif")).toBe("");
    expect(sanitizeFilename("x.jpg", "image/jpg")).toBe("");
  });

  it("exports bucket-parity constraints", () => {
    expect(ALLOWED_MIME).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]);
    expect(MAX_PROOF_BYTES).toBe(10_485_760);
  });
});

describe("proofMagicMatches", () => {
  it("recognizes each allowed file signature", () => {
    expect(proofMagicMatches(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).toBe(true);
    expect(
      proofMagicMatches(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png"
      )
    ).toBe(true);
    expect(
      proofMagicMatches(
        Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        "image/webp"
      )
    ).toBe(true);
    expect(
      proofMagicMatches(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf")
    ).toBe(true);
  });

  it("rejects MIME spoofing", () => {
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(proofMagicMatches(gif, "image/jpeg")).toBe(false);
    expect(proofMagicMatches(gif, "application/pdf")).toBe(false);
  });
});
