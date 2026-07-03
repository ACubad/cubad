"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { useProgress } from "@/lib/progress";
import type { SubjectMeta, Unit } from "@/lib/types";
import { WaterProgress } from "./ui";

export function StudyHomeView({ subject, units }: { subject: SubjectMeta; units: Unit[] }) {
  const { t, bi } = useLang();
  const { state } = useProgress();

  const totalP = units.reduce((n, u) => n + (u.practice?.length ?? 0), 0);
  const doneP = units.reduce(
    (n, u) =>
      n +
      (u.practice ?? []).filter(
        (p) => state.practice[`${subject.slug}/${u.slug}/${p.id}`]?.answered
      ).length,
    0
  );

  return (
    <div className="space-y-10">
      <section className="rise-in pt-4 sm:pt-8">
        <h1 className="font-display text-4xl font-semibold leading-tight text-deniz-deep sm:text-5xl">
          {bi(subject.title)}
        </h1>
        <p className="mt-3 max-w-2xl text-ink-soft">{bi(subject.tagline)}</p>
        {totalP > 0 && (
          <div className="mt-5 max-w-md">
            <div className="mb-1 flex justify-between text-xs font-medium text-ink-soft">
              <span>{t("totalProgress")}</span>
              <span>
                {doneP}/{totalP} {t("questions")}
              </span>
            </div>
            <WaterProgress value={totalP ? doneP / totalP : 0} className="h-2.5" />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-semibold text-ink">{t("allUnits")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {units.map((u) => {
            const notesN = u.notes?.length ?? 0;
            const cardsN = u.flashcards?.length ?? 0;
            const practiceN = u.practice?.length ?? 0;
            return (
              <Link
                key={u.slug}
                href={`/s/${subject.slug}/unit/${u.slug}`}
                className="group rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(28,43,51,0.04)] transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-deniz">
                    {String(u.unit).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">
                  {bi(u.title)}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{bi(u.tagline)}</p>
                <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
                  <span>
                    {notesN} {t("konuAnlatimi").toLowerCase()}
                  </span>
                  <span>
                    {cardsN} {t("cardsCount")}
                  </span>
                  <span>
                    {practiceN} {t("questions")}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
