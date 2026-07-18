"use client";

import Link from "next/link";
import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { useProgress } from "@/lib/progress";
import type { Unit } from "@/lib/types";
import { Mcq, WaterProgress } from "./ui";

export function QuizRunner({ subject, unit }: { subject: string; unit: Unit }) {
  const { t, bi } = useLang();
  const { state, setQuizScore } = useProgress();
  const [current, setCurrent] = useState(0);
  const quiz = unit.quiz ?? [];
  const [answers, setAnswers] = useState<(number | null)[]>(
    () => quiz.map(() => null)
  );

  const total = quiz.length;
  const answered = answers.filter((a) => a !== null).length;
  const score = answers.filter((a, i) => a === quiz[i].correct).length;
  const doneAll = answered === total;
  const savedScore = state.quiz[`${subject}/${unit.slug}`];

  const choose = (i: number) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[current] = i;
      const newScore = next.filter((a, j) => a === quiz[j].correct).length;
      const newAnswered = next.filter((a) => a !== null).length;
      if (newAnswered === total) setQuizScore(subject, unit.slug, newScore, total);
      return next;
    });
  };

  const restart = () => {
    setAnswers(quiz.map(() => null));
    setCurrent(0);
  };

  const item = quiz[current];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link
          href={`/s/${subject}/unit/${unit.slug}`}
          className="text-sm font-medium text-deniz hover:text-deniz-deep"
        >
          ← {bi(unit.title)}
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold text-deniz-deep">
          {t("quiz")}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">{t("quizIntro")}</p>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-[11px] font-semibold text-ink-soft">
          <span>
            {current + 1} {t("of")} {total}
          </span>
          <span>
            {t("score")}: {score}/{answered}
          </span>
        </div>
        <WaterProgress value={answered / total} className="h-1.5" />
        {answered === 0 && savedScore && (
          <p className="mt-2 text-xs font-medium text-moss" role="status">
            {t("quizSaved")}: {savedScore.score}/{savedScore.total}
          </p>
        )}
      </div>

      <div className="rise-in" key={current}>
        <Mcq
          q={item.q}
          options={item.options}
          correct={item.correct}
          explain={item.explain}
          chosen={answers[current]}
          onChoose={choose}
        />
      </div>

      <div className="flex items-center justify-between">
        <button
          disabled={current === 0}
          onClick={() => setCurrent((c) => c - 1)}
          className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-deniz/40 disabled:opacity-40"
        >
          ←
        </button>
        <div className="flex gap-1.5">
          {quiz.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`question ${i + 1}`}
              className={`h-2.5 w-2.5 rounded-full transition-colors ${
                i === current
                  ? "bg-deniz"
                  : answers[i] === null
                    ? "bg-line"
                    : answers[i] === quiz[i].correct
                      ? "bg-moss"
                      : "bg-clay"
              }`}
            />
          ))}
        </div>
        <button
          disabled={current === total - 1}
          onClick={() => setCurrent((c) => c + 1)}
          className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-deniz/40 disabled:opacity-40"
        >
          →
        </button>
      </div>

      {doneAll && (
        <div className="rise-in rounded-2xl border border-moss/30 bg-moss-soft p-5 text-center">
          <p className="font-display text-xl font-semibold text-moss">
            {t("quizFinish")} {score}/{total}
          </p>
          <div className="mt-3 flex justify-center gap-3">
            <button
              onClick={restart}
              className="rounded-full border border-moss/40 px-4 py-2 text-sm font-semibold text-moss transition-colors hover:bg-moss/10"
            >
              {t("quizRestart")}
            </button>
            <Link
              href={`/s/${subject}/unit/${unit.slug}`}
              className="rounded-full bg-deniz px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              {t("backToUnit")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
