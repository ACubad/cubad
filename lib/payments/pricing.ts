export interface TierPrice {
  currency: string;
  amount: number;
  country: string;
}

/** Prefer an exact country price, then the wildcard price, then the first configured price. */
export function priceForCountry(
  prices: TierPrice[] | null | undefined,
  countryCode: string
): TierPrice | null {
  if (!Array.isArray(prices) || prices.length === 0) return null;
  return (
    prices.find((price) => price.country === countryCode) ??
    prices.find((price) => price.country === "*") ??
    prices[0]
  );
}
