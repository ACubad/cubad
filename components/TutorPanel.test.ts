import { describe, expect, it } from "vitest";

import { tutorErrorState } from "./TutorPanel";

describe("TutorPanel errors", () => {
  it("renders the shared-key limit in both languages without clearing BYOK", () => {
    expect(tutorErrorState("rate-limited", "tr")).toEqual({
      forgetKey: false,
      message:
        "Paylaşılan eğitmen saatlik sınırına ulaştı. Bir saat sonra tekrar dene veya kendi API anahtarını kullan.",
    });
    expect(tutorErrorState("rate-limited", "en")).toEqual({
      forgetKey: false,
      message:
        "The shared tutor reached its hourly limit. Try again in an hour or use your own API key.",
    });
  });

  it("continues clearing only rejected or missing keys", () => {
    expect(tutorErrorState("bad-key", "en").forgetKey).toBe(true);
    expect(tutorErrorState("no-key", "tr").forgetKey).toBe(true);
    expect(tutorErrorState("upstream", "en").forgetKey).toBe(false);
  });
});
