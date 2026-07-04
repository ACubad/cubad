"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { useProgress } from "@/lib/progress";
import type { Unit } from "@/lib/types";
import { Md, Tex } from "./Md";
import { TutorPanel } from "./TutorPanel";
import { Callout, DifficultyDots, LikelihoodBadge, WaterProgress } from "./ui";

export function UnitView({ subject, unit }: { subject: string; unit: Unit }) {
  const { t, bi } = useLang();
  const { state } = useProgress();

  const questions = unit.questions ?? [];
  const concept = unit.concept;
  const done = questions.filter((q) => state.q[`${subject}/${q.id}`]?.done).length;
  const quizScore = state.quiz[`${subject}/${unit.slug}`];

  return (
    <div className="space-y-8">
      {/* header */}
      <div className="rise-in">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-deniz">
          {t("units")} · {String(unit.unit).padStart(2, "0")}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-deniz-deep sm:text-4xl">
          {bi(unit.title)}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-soft">{bi(unit.tagline)}</p>
        <div className="mt-4 max-w-md">
          <div className="mb-1 flex justify-between text-xs font-medium text-ink-soft">
            <span>{t("progress")}</span>
            <span>
              {done}/{questions.length}
            </span>
          </div>
          <WaterProgress value={questions.length ? done / questions.length : 0} />
        </div>
      </div>

      {/* concept primer */}
      {concept && (
        <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
          <h2 className="mb-3 font-display text-xl font-semibold text-ink">
            {t("conceptPrimer")}
          </h2>
          <Md>{bi(concept.overview)}</Md>

          {concept.keyFormulas.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">
                {t("keyFormulas")}
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {concept.keyFormulas.map((f, i) => (
                  <div key={i} className="min-w-0 rounded-xl border border-line-soft bg-paper p-4">
                    <p className="mb-1 text-sm font-semibold text-deniz-deep">{bi(f.name)}</p>
                    <div className="overflow-x-auto py-1">
                      <Tex tex={f.latex} />
                    </div>
                    <Md className="mt-1 !text-[13px] text-ink-soft [&_p]:leading-relaxed">{bi(f.meaning)}</Md>
                    <div className="mt-2 text-[13px]">
                      <span className="font-semibold text-deniz">{t("whenToUse")}: </span>
                      <Md className="!text-[13px] inline text-ink-soft [&_p]:inline">{bi(f.whenToUse)}</Md>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {concept.traps.length > 0 && (
            <div className="mt-6">
              <Callout kind="trap" title={t("traps")}>
                <ul className="list-disc space-y-1 pl-4">
                  {concept.traps.map((tr, i) => (
                    <li key={i}>
                      <Md className="[&_p]:inline">{bi(tr)}</Md>
                    </li>
                  ))}
                </ul>
              </Callout>
            </div>
          )}
        </section>
      )}

      {/* questions */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-ink">
            {t("questions").charAt(0).toUpperCase() + t("questions").slice(1)}
          </h2>
          <Link
            href={`/s/${subject}/unit/${unit.slug}/quiz`}
            className="rounded-full bg-deniz px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
          >
            {t("quiz")}
            {quizScore ? ` · ${quizScore.score}/${quizScore.total}` : ""}
          </Link>
        </div>
        <div className="grid gap-2.5">
          {questions.map((q) => {
            const p = state.q[`${subject}/${q.id}`];
            const started = (p?.step ?? 0) > 0;
            return (
              <Link
                key={q.id}
                href={`/s/${subject}/q/${q.id}`}
                className="group flex min-w-0 items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 transition-all hover:border-deniz/40 hover:shadow-[0_4px_16px_rgba(14,90,109,0.08)] sm:gap-4"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold ${
                    p?.done
                      ? "bg-moss text-white"
                      : started
                        ? "bg-deniz-soft text-deniz-deep"
                        : "bg-wash text-ink-soft"
                  }`}
                >
                  {p?.done ? "✓" : q.id.split("-").slice(-1)[0] ? q.code.replace("Uygulama ", "") : q.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink group-hover:text-deniz-deep">
                    {bi(q.title)}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                    <DifficultyDots level={q.difficulty} />
                    <span>
                      {q.steps.length} {t("step").toLowerCase()}
                    </span>
                    {q.examLikelihood === "high" && <LikelihoodBadge level="high" />}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-deniz">
                  <span className="hidden sm:inline">
                    {p?.done ? t("review") : started ? t("continueWalkthrough") : t("startWalkthrough")}
                  </span>
                  <span aria-hidden> →</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <TutorPanel
        subject={subject}
        topicId={`${subject}/unit/${unit.slug}`}
        topicTitle={unit.title}
        context={JSON.stringify({
          type: "unit-primer",
          unit: unit.title,
          overview: concept?.overview,
          keyFormulas: (concept?.keyFormulas ?? []).map((f) => ({
            name: f.name,
            latex: f.latex,
            meaning: f.meaning,
            whenToUse: f.whenToUse,
          })),
          traps: concept?.traps ?? [],
          questions: questions.map((q) => ({ id: q.id, code: q.code, title: q.title })),
        }).slice(0, 60000)}
      />
    </div>
  );
}
