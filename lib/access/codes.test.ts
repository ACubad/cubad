import { describe, expect, it } from "vitest";
import { generateCode, hashCode, normalizeCode } from "./codes";

describe("normalizeCode", () => {
  it("uppercases and strips non-alphanumerics", () => {
    expect(normalizeCode("cbd-7k3m-9pxq")).toBe("CBD7K3M9PXQ");
    expect(normalizeCode("CBD 7K3M 9PXQ")).toBe("CBD7K3M9PXQ");
    expect(normalizeCode(" cbd_7k3m/9pxq ")).toBe("CBD7K3M9PXQ");
  });
});

describe("hashCode", () => {
  it("matches the SQL sha256 parity vector", () => {
    expect(hashCode("CBD7K3M9PXQ")).toBe(
      "0469f76c67a68e98cf8c9baea7aebef3e4f96d68eb7fb77cde202c5ca813c449"
    );
  });

  it("normalizes messy input before hashing", () => {
    expect(hashCode("cbd-7k3m-9pxq")).toBe(
      "0469f76c67a68e98cf8c9baea7aebef3e4f96d68eb7fb77cde202c5ca813c449"
    );
  });
});

describe("generateCode", () => {
  it("uses the CBD-XXXX-XXXX format and Crockford-safe symbols", () => {
    for (let index = 0; index < 500; index += 1) {
      const code = generateCode();
      expect(code).toMatch(/^CBD-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(code.slice(4)).not.toMatch(/[ILOU]/);
    }
  });

  it("normalizes to an eleven-character CBD token", () => {
    const normalized = normalizeCode(generateCode());
    expect(normalized).toHaveLength(11);
    expect(normalized.startsWith("CBD")).toBe(true);
  });

  it("is practically unique across a large local batch", () => {
    const codes = new Set(Array.from({ length: 20_000 }, () => generateCode()));
    expect(codes.size).toBe(20_000);
  });
});
