"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import type { TierPrice } from "@/lib/payments/pricing";
import type { Bi } from "@/lib/types";

interface UpgradeItem {
  slug: string;
  title: Bi;
  description: Bi;
  scopeType: string;
  durationDays: number;
  price: TierPrice | null;
}

const COPY = {
  heading: { tr: "Erişimini yükselt", en: "Upgrade your access" },
  intro: {
    tr: "Bir paket seç, harici ödeme yap ve ödeme bildirimini gönder. Onaydan sonra erişimin açılır.",
    en: "Choose a plan, pay externally, and submit a payment claim. Access opens after review.",
  },
  days: { tr: "gün", en: "days" },
  choose: { tr: "Bu paketi seç", en: "Choose this plan" },
  noPrice: { tr: "Fiyat yakında", en: "Price coming soon" },
  empty: { tr: "Şu anda satışta paket yok.", en: "No plans are on sale right now." },
  history: { tr: "Ödeme bildirimlerim", en: "My payment claims" },
} satisfies Record<string, Bi>;

export function UpgradeList({ items }: { items: UpgradeItem[] }) {
  const { bi, lang } = useLang();
  const locale = lang === "tr" ? "tr-TR" : "en-GB";

  return (
    <main className="mx-auto max-w-2xl px-1 py-4 sm:px-4 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-deniz-deep">
            {bi(COPY.heading)}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">{bi(COPY.intro)}</p>
        </div>
        <Link href="/upgrade/claims" className="text-sm font-medium text-deniz underline">
          {bi(COPY.history)}
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="mt-8 rounded-xl border border-line bg-card p-6 text-center text-ink-soft">
          {bi(COPY.empty)}
        </p>
      ) : (
        <ul className="mt-6 grid gap-4">
          {items.map((item) => (
            <li key={item.slug} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-ink">{bi(item.title)}</h2>
                  {bi(item.description) && (
                    <p className="mt-1 text-sm text-ink-soft">{bi(item.description)}</p>
                  )}
                  <p className="mt-2 text-xs text-ink-faint">
                    {item.durationDays} {bi(COPY.days)} · {item.scopeType}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {item.price ? (
                    <p className="font-mono text-lg font-semibold text-deniz-deep">
                      {item.price.amount.toLocaleString(locale)} {item.price.currency}
                    </p>
                  ) : (
                    <p className="text-xs text-ink-faint">{bi(COPY.noPrice)}</p>
                  )}
                </div>
              </div>
              <Link
                href={`/upgrade/pay/${item.slug}`}
                className="mt-4 inline-flex rounded-xl bg-deniz px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
              >
                {bi(COPY.choose)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
