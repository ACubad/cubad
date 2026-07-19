import { describe, expect, it } from "vitest";
import {
  formatExpiry,
  tmplAdminNewClaim,
  tmplClaimApproved,
  tmplClaimRejected,
} from "./templates";

const EXPIRY = "2026-11-09T00:00:00.000Z";

describe("payment email templates", () => {
  it("formats expiry deterministically in UTC", () => {
    expect(formatExpiry(EXPIRY, "en")).toBe("9 November 2026 (UTC)");
    expect(formatExpiry(EXPIRY, "tr")).toBe("9 Kasım 2026 (UTC)");
  });

  it("renders the admin notification snapshot", () => {
    const content = tmplAdminNewClaim({
      studentName: "Amina H.",
      studentEmail: "amina@example.com",
      tierTitle: "Term — All access",
      amount: "15000",
      currency: "TZS",
      method: "mpesa",
      payerRef: "SFC8KL29XY",
      dashboardUrl: "https://cubad.vercel.app/admin/payments/abc",
    });
    expect(content.subject).toMatchSnapshot();
    expect(content.html).toMatchSnapshot();
    expect(content.text).toMatchSnapshot();
  });

  it("escapes student-controlled HTML fields", () => {
    const content = tmplAdminNewClaim({
      studentName: "<script>x</script>",
      studentEmail: "a@b.c",
      tierTitle: "T",
      amount: "1",
      currency: "USD",
      method: "bank",
      payerRef: "<img>",
      dashboardUrl: "https://example.com/x",
    });
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;");
    expect(content.html).toContain("&lt;img&gt;");
  });

  it("renders bilingual approval snapshots with code and no-redeem note", () => {
    for (const lang of ["tr", "en"] as const) {
      const content = tmplClaimApproved(lang, {
        code: "CBD-7K3M-9PXQ",
        tierTitle: "Term — All access",
        expiresIso: EXPIRY,
        appUrl: "https://cubad.vercel.app",
      });
      expect(content.html).toContain("CBD-7K3M-9PXQ");
      expect(content.subject).toMatchSnapshot(`approved-subject-${lang}`);
      expect(content.html).toMatchSnapshot(`approved-html-${lang}`);
      expect(content.text).toMatchSnapshot(`approved-text-${lang}`);
    }
  });

  it("renders bilingual rejection snapshots with an escaped reason", () => {
    for (const lang of ["tr", "en"] as const) {
      const content = tmplClaimRejected(lang, {
        reason: "No matching transaction. <reviewed>",
        appUrl: "https://cubad.vercel.app",
      });
      expect(content.text).toContain("No matching transaction.");
      expect(content.html).toContain("&lt;reviewed&gt;");
      expect(content.subject).toMatchSnapshot(`rejected-subject-${lang}`);
      expect(content.html).toMatchSnapshot(`rejected-html-${lang}`);
      expect(content.text).toMatchSnapshot(`rejected-text-${lang}`);
    }
  });
});
