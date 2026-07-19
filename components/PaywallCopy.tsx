"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";

interface Price {
  currency: string;
  amount: number;
  country: string;
}

interface Tier {
  id: string;
  slug: string;
  title: { tr: string; en: string };
  description: { tr: string; en: string };
  duration_days: number;
  prices: Price[];
}

export function PaywallCopy({
  signedIn,
  tiers,
  redeemHref,
  upgradeHref,
  signInHref,
  signUpHref,
}: {
  signedIn: boolean;
  tiers: { tier: Tier; price: Price | null }[];
  redeemHref: string;
  upgradeHref: string;
  signInHref: string;
  signUpHref: string;
}) {
  const { t, bi, lang } = useLang();
  return (
    <section className="rise-in mx-auto max-w-2xl">
      <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <span aria-hidden>🔒</span>
          {t("locked")}
        </div>
        <h1 className="font-display text-2xl font-semibold text-deniz-deep">
          {t("paywallTitle")}
        </h1>
        <p className="mt-2 text-ink-soft">{t("paywallIntro")}</p>

        {signedIn ? (
          <>
            <h2 className="mb-3 mt-6 font-display text-lg font-semibold text-ink">
              {t("choosePlan")}
            </h2>
            <div className="grid gap-3">
              {tiers.map(({ tier, price }) => (
                <div
                  key={tier.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-line bg-paper px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-ink">{bi(tier.title)}</p>
                    <p className="text-sm text-ink-soft">
                      {tier.duration_days} {t("daysLabel")}
                      {bi(tier.description) ? ` · ${bi(tier.description)}` : ""}
                    </p>
                  </div>
                  {price && (
                    <div className="text-right font-mono text-sm font-semibold text-deniz-deep">
                      {price.amount.toLocaleString(lang === "tr" ? "tr-TR" : "en-GB")} {price.currency}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-faint">{t("paymentComingSoon")}</p>
            <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
              <Link
                href={redeemHref}
                className="inline-flex rounded-xl bg-deniz px-4 py-2.5 font-semibold text-white transition-colors hover:bg-deniz-deep"
              >
                {t("iHaveCode")}
              </Link>
              <Link
                href={upgradeHref}
                className="inline-flex rounded-xl border border-deniz/30 px-4 py-2.5 font-semibold text-deniz-deep transition-colors hover:bg-deniz-soft"
              >
                {t("choosePlan")}
              </Link>
            </div>
          </>
        ) : (
          <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
            <Link
              href={signInHref}
              className="inline-flex rounded-xl bg-deniz px-4 py-2.5 font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              {t("signInToStudy")}
            </Link>
            <Link
              href={signUpHref}
              className="inline-flex rounded-xl border border-deniz/30 px-4 py-2.5 font-semibold text-deniz-deep transition-colors hover:bg-deniz-soft"
            >
              {t("createAccountToStudy")}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
