import { describe, it, expect } from "vitest";
import { legacyRowId } from "./passcode";

describe("legacyRowId — compatible with app/api/sync/route.ts rowId", () => {
  it("hashes 'cubad:' + trimmed code with sha256 (known vector)", () => {
    // Verified: sha256("cubad:test1234") in hex.
    expect(legacyRowId("test1234")).toBe(
      "20c6faf69f11b0623185b05a78936ff422228a7b693d29627ab965a6c00c677f"
    );
  });

  it("trims surrounding whitespace exactly like the legacy route", () => {
    expect(legacyRowId("  test1234 ")).toBe(legacyRowId("test1234"));
  });

  it("is case-sensitive (legacy route did not normalize case)", () => {
    expect(legacyRowId("TEST1234")).not.toBe(legacyRowId("test1234"));
  });
});
