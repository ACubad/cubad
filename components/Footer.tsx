"use client";

import { useLang } from "@/lib/i18n";

export function Footer() {
  const { t } = useLang();
  return (
    <footer className="mt-10 border-t border-line bg-card/60">
      <div className="mx-auto max-w-5xl px-4 py-6 text-center text-xs text-ink-faint">
        <p>{t("source")}</p>
        <p className="mt-1 font-display text-sm text-deniz/70">cubad · {t("tagline")}</p>
      </div>
    </footer>
  );
}
