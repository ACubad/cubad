"use client";

import { useLang } from "@/lib/i18n";

export function AccessBadge({ expiresAt }: { expiresAt: string }) {
  const { t, lang } = useLang();
  const formatted = new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(expiresAt));
  return (
    <span suppressHydrationWarning className="inline-flex rounded-full bg-deniz-soft px-2.5 py-1 text-xs font-medium text-deniz-deep">
      {t("accessUntil")} {formatted}
    </span>
  );
}
