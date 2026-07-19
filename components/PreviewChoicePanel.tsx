"use client";

import { choosePreviewAction } from "@/app/preview/actions";
import { useLang } from "@/lib/i18n";

export function PreviewChoicePanel({
  subjectSlug,
  unitSlug,
}: {
  subjectSlug: string;
  unitSlug: string;
}) {
  const { t } = useLang();
  return (
    <section className="rise-in mx-auto max-w-xl rounded-2xl border border-moss/30 bg-card p-6 sm:p-8">
      <span className="inline-flex rounded-full bg-moss-soft px-2.5 py-1 text-xs font-semibold text-moss">
        {t("freePreview")}
      </span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-deniz-deep">
        {t("choosePreviewTitle")}
      </h1>
      <p className="mt-2 text-ink-soft">{t("choosePreviewIntro")}</p>
      <form action={choosePreviewAction} className="mt-5">
        <input type="hidden" name="subject" value={subjectSlug} />
        <input type="hidden" name="unit" value={unitSlug} />
        <button
          type="submit"
          className="rounded-xl bg-deniz px-4 py-2.5 font-semibold text-white transition-colors hover:bg-deniz-deep"
        >
          {t("choosePreviewButton")}
        </button>
      </form>
      <p className="mt-4 text-xs leading-relaxed text-ink-faint">{t("previewPrivacyNote")}</p>
    </section>
  );
}
