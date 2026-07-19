import { describe, expect, it } from "vitest";
import { priceForCountry, type TierPrice } from "./pricing";

const PRICES: TierPrice[] = [
  { currency: "TZS", amount: 15000, country: "TZ" },
  { currency: "USD", amount: 6, country: "*" },
];

describe("priceForCountry", () => {
  it("prefers an exact country match", () => {
    expect(priceForCountry(PRICES, "TZ")).toEqual(PRICES[0]);
  });

  it("falls back to wildcard and then first", () => {
    expect(priceForCountry(PRICES, "TR")).toEqual(PRICES[1]);
    expect(priceForCountry([PRICES[0]], "TR")).toEqual(PRICES[0]);
  });

  it("returns null for an empty price list", () => {
    expect(priceForCountry([], "TZ")).toBeNull();
    expect(priceForCountry(null, "TZ")).toBeNull();
  });
});
