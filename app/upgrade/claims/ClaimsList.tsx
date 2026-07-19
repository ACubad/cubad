"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import type { Bi } from "@/lib/types";
import { cancelClaim } from "../actions";

const COPY = {
  heading: { tr: "Ödeme bildirimlerim", en: "My payment claims" },
  empty: { tr: "Henüz bildirimin yok.", en: "You have no claims yet." },
  submitted: {
    tr: "Bildirimin alındı. İnceleme sonrasında e-posta ile bilgilendirileceksin.",
    en: "Your claim was received. We will email you after review.",
  },
  cancel: { tr: "İptal et", en: "Cancel" },
  resubmit: { tr: "Yeniden gönder", en: "Resubmit" },
  note: { tr: "İnceleme notu", en: "Review note" },
  browse: { tr: "Paketlere göz at", en: "Browse plans" },
  unknownTier: { tr: "Paket", en: "Plan" },
} satisfies Record<string, Bi>;

const STATUS: Record<string, { label: Bi; className: string }> = {
  pending: { label: { tr: "Bekliyor", en: "Pending" }, className: "bg-amber-soft text-amber" },
  approved: { label: { tr: "Onaylandı", en: "Approved" }, className: "bg-moss-soft text-moss" },
  rejected: { label: { tr: "Reddedildi", en: "Rejected" }, className: "bg-clay-soft text-clay" },
};

interface ClaimItem {
  id: string;
  tierSlug: string;
  tierTitle: Bi;
  amount: number | null;
  currency: string;
  method: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string;
  createdAt: string;
}

export function ClaimsList({ items, submitted }: { items: ClaimItem[]; submitted: boolean }) {
  const { bi, lang } = useLang();
  const locale = lang === "tr" ? "tr-TR" : "en-GB";

  return (
    <main className="mx-auto max-w-2xl px-1 py-4 sm:px-4 sm:py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold text-deniz-deep">{bi(COPY.heading)}</h1>
        <Link href="/upgrade" className="text-sm font-medium text-deniz underline">
          {bi(COPY.browse)}
        </Link>
      </div>

      {submitted && (
        <p className="mt-4 rounded-xl border border-moss/25 bg-moss-soft px-4 py-3 text-sm text-moss">
          {bi(COPY.submitted)}
        </p>
      )}

      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-card p-6 text-center">
          <p className="text-ink-soft">{bi(COPY.empty)}</p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4">
          {items.map((claim) => {
            const status = STATUS[claim.status];
            return (
              <li key={claim.id} className="rounded-2xl border border-line bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">
                      {bi(claim.tierTitle) || bi(COPY.unknownTier)}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-ink-faint">
                      {claim.amount === null
                        ? "—"
                        : `${claim.amount.toLocaleString(locale)} ${claim.currency}`} · {claim.method}
                    </p>
                    <time dateTime={claim.createdAt} className="mt-1 block text-xs text-ink-faint">
                      {claim.createdAt.slice(0, 10)}
                    </time>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                    {bi(status.label)}
                  </span>
                </div>

                {claim.status === "rejected" && claim.reviewNote && (
                  <div className="mt-3 rounded-lg border border-clay/25 bg-clay-soft px-3 py-2 text-sm text-clay">
                    <span className="font-semibold">{bi(COPY.note)}: </span>
                    {claim.reviewNote}
                  </div>
                )}

                <div className="mt-3 flex gap-3">
                  {claim.status === "pending" && (
                    <form action={cancelClaim}>
                      <input type="hidden" name="claimId" value={claim.id} />
                      <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-soft transition-colors hover:border-clay hover:text-clay">
                        {bi(COPY.cancel)}
                      </button>
                    </form>
                  )}
                  {claim.status === "rejected" && claim.tierSlug && (
                    <Link href={`/upgrade/pay/${claim.tierSlug}`} className="rounded-lg bg-deniz px-3 py-1.5 text-sm font-semibold text-white hover:bg-deniz-deep">
                      {bi(COPY.resubmit)}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
