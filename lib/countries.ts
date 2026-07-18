import type { Bi } from "./types";

export const COUNTRIES: { code: string; name: Bi }[] = [
  { code: "TZ", name: { en: "Tanzania", tr: "Tanzanya" } },
  { code: "TR", name: { en: "Türkiye", tr: "Türkiye" } },
  { code: "KE", name: { en: "Kenya", tr: "Kenya" } },
  { code: "UG", name: { en: "Uganda", tr: "Uganda" } },
  { code: "other", name: { en: "Other", tr: "Diğer" } },
];

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code);
