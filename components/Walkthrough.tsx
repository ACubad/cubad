"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useProgress } from "@/lib/progress";
import type { Bi, Question, Step } from "@/lib/types";
import { Chart } from "./Chart";
import { GraphStory } from "./GraphStory";
import { Md, Tex } from "./Md";
import { Callout, DataTable, DifficultyDots, LikelihoodBadge, Mcq, WaterProgress } from "./ui";
import { TutorPanel } from "./TutorPanel";

function StepCard({
  step,
  index,
  revealed,
  isCurrent,
  onReveal,
}: {
  step: Step;
  index: number;
  revealed: boolean;
  isCurrent: boolean;
  onReveal: () => void;
}) {
  const { t, bi } = useLang();
  const [hintShown, setHintShown] = useState(false);
  const [checkChoice, setCheckChoice] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isCurrent && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isCurrent]);

  if (!revealed && !isCurrent) return null;

  return (
    <div
      ref={ref}
      className={`rise-in rounded-2xl border bg-card p-5 sm:p-6 ${
        isCurrent ? "border-deniz/40 shadow-[0_8px_24px_rgba(14,90,109,0.10)]" : "border-line"
      }`}
    >
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold ${
            revealed ? "bg-deniz text-white" : "bg-deniz-soft text-deniz-deep"
          }`}
        >
          {index + 1}
        </span>
        <h3 className="font-display text-lg font-semibold text-ink">{bi(step.title)}</h3>
      </div>

      {/* guiding question — always visible once the step is reached */}
      <div className="mb-4 rounded-xl bg-wash px-4 py-3">
        <p className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-deniz">
          {t("guidingIntro")}
        </p>
        <Md className="text-[0.95rem]">{bi(step.guiding)}</Md>
      </div>

      {!revealed ? (
        <div className="space-y-3">
          {hintShown && (
            <div className="rise-in">
              <Callout kind="hint" title={t("hint")}>
                <Md>{bi(step.hint)}</Md>
              </Callout>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!hintShown && (
              <button
                onClick={() => setHintShown(true)}
                className="rounded-full border border-amber/40 bg-amber-soft px-4 py-2 text-sm font-semibold text-amber transition-colors hover:border-amber"
              >
                💡 {t("showHint")}
              </button>
            )}
            <button
              onClick={onReveal}
              className="rounded-full bg-deniz px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              {t("revealStep")} →
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Md>{bi(step.work)}</Md>

          {step.story && <GraphStory story={step.story} />}

          {step.chart && <Chart spec={step.chart} />}

          {step.result && (
            <div className="rounded-xl border border-moss/25 bg-moss-soft px-4 py-3">
              <p className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-moss">
                {t("result")}
              </p>
              <div className="overflow-x-auto">
                <Tex tex={step.result} />
              </div>
            </div>
          )}

          <Callout kind="why" title={t("whyThis")}>
            <Md>{bi(step.why)}</Md>
          </Callout>

          {step.check && (
            <Mcq
              q={step.check.q}
              options={step.check.options}
              correct={step.check.correct}
              explain={step.check.explain}
              chosen={checkChoice}
              onChoose={setCheckChoice}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function Walkthrough({
  subject,
  unitTitle,
  unitSlug,
  question,
  prevId,
  nextId,
  hasQuiz = true,
}: {
  subject: string;
  unitTitle: Bi;
  unitSlug: string;
  question: Question;
  prevId: string | null;
  nextId: string | null;
  hasQuiz?: boolean;
}) {
  const { t, bi } = useLang();
  const { state, setStep, markDone } = useProgress();
  const [revealed, setRevealed] = useState(0);
  const [statementOpen, setStatementOpen] = useState(true);
  const restored = useRef(false);

  const total = question.steps.length;
  const finished = revealed >= total;

  // restore saved progress once it loads from localStorage
  useEffect(() => {
    if (restored.current) return;
    const saved = state.q[`${subject}/${question.id}`]?.step ?? 0;
    if (saved > 0) {
      setRevealed(Math.min(saved, total));
      restored.current = true;
    }
  }, [state, subject, question.id, total]);

  const reveal = (i: number) => {
    const next = i + 1;
    setRevealed(next);
    setStep(subject, question.id, next);
    if (next >= total) markDone(subject, question.id);
  };

  const revealAll = () => {
    setRevealed(total);
    setStep(subject, question.id, total);
    markDone(subject, question.id);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* breadcrumb + header */}
      <div>
        <Link
          href={`/s/${subject}/unit/${unitSlug}`}
          className="text-sm font-medium text-deniz hover:text-deniz-deep"
        >
          ← {bi(unitTitle)}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-2xl font-semibold text-deniz-deep sm:text-3xl">
            {question.code} · {bi(question.title)}
          </h1>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
          <DifficultyDots level={question.difficulty} />
          <LikelihoodBadge level={question.examLikelihood} />
          <button
            onClick={revealAll}
            className="no-print rounded-full border border-line px-3 py-1 font-medium text-ink-soft transition-colors hover:border-deniz/40 hover:text-deniz"
          >
            {t("revealAll")}
          </button>
        </div>
      </div>

      {/* sticky progress */}
      <div className="sticky top-[57px] z-30 -mx-1 rounded-full bg-paper/95 px-1 py-2 backdrop-blur">
        <div className="mb-1 flex justify-between px-1 text-[11px] font-semibold text-ink-soft">
          <span>
            {t("step")} {Math.min(revealed + 1, total)} {t("of")} {total}
          </span>
          {finished && <span className="text-moss">✓ {t("done")}</span>}
        </div>
        <WaterProgress value={revealed / total} className="h-1.5" />
      </div>

      {/* statement */}
      <section className="rounded-2xl border border-line bg-card">
        <button
          onClick={() => setStatementOpen((o) => !o)}
          className="flex w-full items-center justify-between px-5 py-3 text-left"
        >
          <span className="text-sm font-semibold uppercase tracking-wide text-deniz">
            {t("statement")}
          </span>
          <span className="text-ink-faint">{statementOpen ? "−" : "+"}</span>
        </button>
        {statementOpen && (
          <div className="space-y-4 border-t border-line-soft px-5 pb-5 pt-4">
            <Md>{bi(question.statement)}</Md>

            {question.given.length > 0 && (
              <div>
                <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
                  {t("givenValues")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {question.given.map((g, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-2 rounded-lg border border-line-soft bg-paper px-2.5 py-1.5 text-sm"
                      title={bi(g.label)}
                    >
                      <Tex tex={`${g.symbol} = ${g.value}`} block={false} />
                    </span>
                  ))}
                </div>
              </div>
            )}

            {question.tables?.map((tb, i) => <DataTable key={i} table={tb} />)}

            <div className="rounded-xl bg-deniz-soft px-4 py-3">
              <p className="mb-0.5 text-[13px] font-semibold uppercase tracking-wide text-deniz">
                {t("goal")}
              </p>
              <Md className="text-[0.95rem]">{bi(question.goal)}</Md>
            </div>
          </div>
        )}
      </section>

      {/* steps */}
      <div className="space-y-4">
        {question.steps.map((s, i) => (
          <StepCard
            key={i}
            step={s}
            index={i}
            revealed={i < revealed}
            isCurrent={i === revealed}
            onReveal={() => reveal(i)}
          />
        ))}
      </div>

      {/* finale */}
      {finished && (
        <div className="space-y-4">
          {question.chart && (
            <div className="rise-in rounded-2xl border border-line bg-card p-5">
              <Chart spec={question.chart} />
            </div>
          )}

          {question.charts?.map((c, i) => (
            <div key={i} className="rise-in rounded-2xl border border-line bg-card p-5">
              <Chart spec={c} />
            </div>
          ))}

          <div className="rise-in">
            <Callout kind="success" title={t("finalAnswer")}>
              <Md>{bi(question.finalAnswer)}</Md>
            </Callout>
          </div>

          {question.traps.length > 0 && (
            <div className="rise-in">
              <Callout kind="trap" title={t("traps")}>
                <ul className="list-disc space-y-1.5 pl-4">
                  {question.traps.map((tr, i) => (
                    <li key={i}>
                      <Md className="[&_p]:inline">{bi(tr)}</Md>
                    </li>
                  ))}
                </ul>
              </Callout>
            </div>
          )}

          {question.whatIfs.length > 0 && (
            <section className="rise-in rounded-2xl border border-line bg-card p-5">
              <h3 className="mb-3 font-display text-lg font-semibold text-ink">
                {t("whatIfs")}
              </h3>
              <div className="space-y-2">
                {question.whatIfs.map((w, i) => (
                  <details
                    key={i}
                    className="group rounded-xl border border-line-soft bg-paper px-4 py-3"
                  >
                    <summary className="cursor-pointer list-none font-medium text-deniz-deep marker:hidden">
                      <span className="mr-2 text-deniz" aria-hidden>
                        ↯
                      </span>
                      <span className="[&_p]:inline">
                        <Md>{bi(w.scenario)}</Md>
                      </span>
                    </summary>
                    <div className="mt-2 border-t border-line-soft pt-2">
                      <Md className="text-sm">{bi(w.answer)}</Md>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* prev / next */}
          <div className="flex items-center justify-between gap-3 pt-2">
            {prevId ? (
              <Link
                href={`/s/${subject}/q/${prevId}`}
                className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-deniz/40 hover:text-deniz"
              >
                ← {t("prevQuestion")}
              </Link>
            ) : (
              <span />
            )}
            {nextId ? (
              <Link
                href={`/s/${subject}/q/${nextId}`}
                className="rounded-full bg-deniz px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
              >
                {t("nextQuestion")} →
              </Link>
            ) : hasQuiz ? (
              <Link
                href={`/s/${subject}/unit/${unitSlug}/quiz`}
                className="rounded-full bg-deniz px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
              >
                {t("quiz")} →
              </Link>
            ) : (
              <Link
                href={`/s/${subject}/unit/${unitSlug}`}
                className="rounded-full bg-deniz px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
              >
                {t("backToUnit")} →
              </Link>
            )}
          </div>
        </div>
      )}

      <TutorPanel question={question} />
    </div>
  );
}
