"use client";

import { useLang } from "@/lib/i18n";

export function TrackCatalogHeading() {
  const { t } = useLang();
  return <h1 className="mb-4 font-display text-3xl font-semibold text-ink">{t("yourSubjects")}</h1>;
}
