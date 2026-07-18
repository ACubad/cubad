"use client";

import { useLang } from "@/lib/i18n";
import type { Bi } from "@/lib/types";

export function AccountHeadingClient({ email, trackTitle }: { email: string; trackTitle: Bi | null }) {
  const { t, bi } = useLang();
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">{t("accountTitle")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{email}</p>
      {trackTitle && (
        <p className="mt-1 text-sm">
          <span className="text-ink-faint">{t("yourTrack")}: </span>
          <span className="font-semibold text-deniz-deep">{bi(trackTitle)}</span>
        </p>
      )}
    </div>
  );
}
