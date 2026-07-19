import { describe, expect, it } from "vitest";
import { safeNextPath } from "./navigation";

describe("safeNextPath", () => {
  it.each(["/", "/account", "/redeem?next=%2Fs%2Fhidroloji", "/s/hidroloji#units"])(
    "keeps the same-site path %s",
    (value) => expect(safeNextPath(value)).toBe(value)
  );

  it.each([
    undefined,
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\/evil.example",
    "/safe\\evil.example",
    "/safe\nLocation: https://evil.example",
  ])("rejects unsafe destination %s", (value) => {
    expect(safeNextPath(value, "/fallback")).toBe("/fallback");
  });
});
