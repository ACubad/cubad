"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";

export function UpgradeCopy({ redeemHref }: { redeemHref: string }) {
  const { t } = useLang();
  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-line bg-card p-6 sm:p-8">
      <h1 className="font-display text-2xl font-semibold text-deniz-deep">{t("upgradeTitle")}</h1>
      <p className="mt-2 text-ink-soft">{t("upgradeIntro")}</p>
      <Link
        href={redeemHref}
        className="mt-5 inline-flex rounded-xl bg-deniz px-4 py-2.5 font-semibold text-white hover:bg-deniz-deep"
      >
        {t("iHaveCode")}
      </Link>
    </section>
  );
}
