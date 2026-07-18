"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { useProgress } from "@/lib/progress";
import type { SubjectMeta, Unit } from "@/lib/types";
import { ResetCard } from "./ResetCard";
import { WaterProgress } from "./ui";

export function SubjectPicker({
  subjects,
  unitsBySubject,
}: {
  subjects: SubjectMeta[];
  unitsBySubject: Record<string, Unit[]>;
}) {
  const { lang, t, bi } = useLang();
  const { state } = useProgress();

  return (
    <div className="space-y-10">
      {/* hero */}
      <section className="rise-in pt-4 sm:pt-8">
        <h1 className="font-display text-4xl font-semibold leading-tight text-deniz-deep sm:text-5xl">
          {lang === "tr" ? (
            <>
              Sınavı <em className="text-deniz">anlayarak</em> geç.
            </>
          ) : (
            <>
              Pass your exams by <em className="text-deniz">understanding</em> them.
            </>
          )}
        </h1>
        <p className="mt-3 max-w-2xl text-ink-soft">
          {lang === "tr"
            ? "Her ders, elinden tutan bir öğretmen gibi adım adım işlenir."
            : "Every subject unfolds like a tutor holding your hand, step by step."}
        </p>
      </section>

      {/* subject grid */}
      <section>
        <h2 className="mb-4 font-display text-2xl font-semibold text-ink">{t("subjects")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {subjects.map((s) => {
            const units = unitsBySubject[s.slug] ?? [];
            let done = 0;
            let total = 0;
            if (s.section_order === "walkthrough") {
              total = units.reduce((n, u) => n + (u.questions?.length ?? 0), 0);
              done = units.reduce(
                (n, u) =>
                  n + (u.questions ?? []).filter((q) => state.q[`${s.slug}/${q.id}`]?.done).length,
                0
              );
            } else {
              total = units.reduce((n, u) => n + (u.practice?.length ?? 0), 0);
              done = units.reduce(
                (n, u) =>
                  n +
                  (u.practice ?? []).filter(
                    (p) => state.practice[`${s.slug}/${u.slug}/${p.id}`]?.answered
                  ).length,
                0
              );
            }
            return (
              <Link
                key={s.slug}
                href={`/s/${s.slug}`}
                className="group rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(28,43,51,0.04)] transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-ink-faint">
                    {units.length} {t("units").toLowerCase()}
                  </span>
                </div>
                <h3 className="font-display text-xl font-semibold text-ink group-hover:text-deniz-deep">
                  {bi(s.title)}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{bi(s.tagline)}</p>
                <div className="mt-4">
                  <WaterProgress value={total ? done / total : 0} />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <ResetCard subjects={subjects} />
    </div>
  );
}
