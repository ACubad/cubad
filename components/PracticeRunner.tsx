"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useProgress } from "@/lib/progress";
import type { PracticeItem, Unit } from "@/lib/types";
import { Md } from "./Md";
import { Mcq, DifficultyDots, WaterProgress } from "./ui";

type TypeFilter = "all" | "mcq" | "open";

function answerStorageKey(subject: string, unitSlug: string, qid: string) {
  return `cubad:practice-answer:${subject}:${unitSlug}:${qid}`;
}

export function PracticeRunner({ subject, unit }: { subject: string; unit: Unit }) {
  const { t, bi } = useLang();
  const { state, setPractice } = useProgress();

  const items = useMemo(() => unit.practice ?? [], [unit.practice]);
  const notes = unit.notes ?? [];

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<Set<1 | 2 | 3>>(new Set());
  const [examStyleOnly, setExamStyleOnly] = useState(false);
  const [sectionFilter, setSectionFilter] = useState<string>("");
  const [current, setCurrent] = useState(0);
  const [jumpInput, setJumpInput] = useState("");

  // per-question MCQ choice / open-ended UI state (session only, resets on filter change)
  const [chosen, setChosen] = useState<Record<string, number | null>>({});
  const [revealedAnswer, setRevealedAnswer] = useState<Record<string, boolean>>({});
  const [ownAttempt, setOwnAttempt] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (typeFilter !== "all" && it.type !== typeFilter) return false;
      if (difficultyFilter.size > 0 && !difficultyFilter.has(it.difficulty)) return false;
      if (examStyleOnly && !it.examStyle) return false;
      if (sectionFilter && !it.covers.includes(sectionFilter)) return false;
      return true;
    });
  }, [items, typeFilter, difficultyFilter, examStyleOnly, sectionFilter]);

  useEffect(() => {
    setCurrent(0);
  }, [typeFilter, difficultyFilter, examStyleOnly, sectionFilter]);

  // restore saved own-attempt text from localStorage lazily per question
  useEffect(() => {
    const it = filtered[current];
    if (!it || it.type !== "open") return;
    if (ownAttempt[it.id] !== undefined) return;
    try {
      const saved = window.localStorage.getItem(answerStorageKey(subject, unit.slug, it.id));
      if (saved !== null) setOwnAttempt((prev) => ({ ...prev, [it.id]: saved }));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, current, subject, unit.slug]);

  const total = filtered.length;
  const answeredCount = filtered.filter(
    (it) => state.practice[`${subject}/${unit.slug}/${it.id}`]?.answered
  ).length;
  const mcqItems = filtered.filter((it) => it.type === "mcq");
  const mcqCorrect = mcqItems.filter(
    (it) => state.practice[`${subject}/${unit.slug}/${it.id}`]?.correct
  ).length;

  const item: PracticeItem | undefined = filtered[current];

  const toggleDifficulty = (d: 1 | 2 | 3) => {
    setDifficultyFilter((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const chooseMcq = (i: number) => {
    if (!item || item.type !== "mcq") return;
    setChosen((prev) => ({ ...prev, [item.id]: i }));
    setPractice(subject, unit.slug, item.id, {
      answered: true,
      correct: i === item.correct,
    });
  };

  const showAnswer = () => {
    if (!item) return;
    setRevealedAnswer((prev) => ({ ...prev, [item.id]: true }));
  };

  const selfGrade = (correct: boolean) => {
    if (!item) return;
    setPractice(subject, unit.slug, item.id, { answered: true, correct });
  };

  const updateOwnAttempt = (text: string) => {
    if (!item) return;
    setOwnAttempt((prev) => ({ ...prev, [item.id]: text }));
    try {
      window.localStorage.setItem(answerStorageKey(subject, unit.slug, item.id), text);
    } catch {
      /* ignore */
    }
  };

  const jumpTo = () => {
    const n = parseInt(jumpInput, 10);
    if (Number.isFinite(n) && n >= 1 && n <= total) {
      setCurrent(n - 1);
      setJumpInput("");
    }
  };

  // compact grouped-in-tens dot strip for large sets
  const groups: number[][] = [];
  for (let i = 0; i < total; i += 10) {
    groups.push(Array.from({ length: Math.min(10, total - i) }, (_, k) => i + k));
  }

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
          ❓ {t("practiceTitle")}
        </h1>
      </div>

      {/* filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "mcq", "open"] as TypeFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                typeFilter === f
                  ? "border-deniz bg-deniz text-white"
                  : "border-line bg-card text-ink-soft hover:border-deniz/40"
              }`}
            >
              {f === "all" ? t("all") : f === "mcq" ? t("mcqOnly") : t("openOnly")}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          {([1, 2, 3] as const).map((d) => (
            <button
              key={d}
              onClick={() => toggleDifficulty(d)}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                difficultyFilter.has(d)
                  ? "border-deniz bg-deniz-soft text-deniz-deep"
                  : "border-line bg-card text-ink-soft hover:border-deniz/40"
              }`}
            >
              {d}
            </button>
          ))}
          <button
            onClick={() => setExamStyleOnly((v) => !v)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              examStyleOnly
                ? "border-amber bg-amber-soft text-amber"
                : "border-line bg-card text-ink-soft hover:border-deniz/40"
            }`}
          >
            {t("examStyleOnly")}
          </button>
        </div>
        {notes.length > 0 && (
          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-ink-soft"
          >
            <option value="">{t("filterBySection")}</option>
            {notes.map((n) => (
              <option key={n.id} value={n.id}>
                {bi(n.title)}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* progress */}
      <div>
        <div className="mb-1 flex justify-between text-[11px] font-semibold text-ink-soft">
          <span>
            {answeredCount}/{total}
          </span>
          {mcqItems.length > 0 && (
            <span>
              {t("score")}: {mcqCorrect}/{mcqItems.length}
            </span>
          )}
        </div>
        <WaterProgress value={total ? answeredCount / total : 0} className="h-1.5" />
      </div>

      {total === 0 ? (
        <p className="text-sm text-ink-soft">{t("noCardsDue")}</p>
      ) : item ? (
        <>
          <div className="rise-in space-y-3" key={item.id}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
              <DifficultyDots level={item.difficulty} />
              {item.examStyle && (
                <span className="rounded-full bg-amber-soft px-2 py-0.5 font-semibold text-amber">
                  {t("examStyleOnly")}
                </span>
              )}
              {item.covers.map((cid) => (
                <Link
                  key={cid}
                  href={`/s/${subject}/unit/${unit.slug}#${cid}`}
                  className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-soft hover:border-deniz/40 hover:text-deniz"
                >
                  {cid}
                </Link>
              ))}
            </div>

            {item.type === "mcq" ? (
              <Mcq
                q={item.q}
                options={item.options}
                correct={item.correct}
                explain={item.explain}
                chosen={chosen[item.id] ?? null}
                onChoose={chooseMcq}
              />
            ) : (
              <div className="rounded-xl border border-line bg-card p-4">
                <Md className="mb-3 font-medium">{bi(item.q)}</Md>
                <textarea
                  value={ownAttempt[item.id] ?? ""}
                  onChange={(e) => updateOwnAttempt(e.target.value)}
                  placeholder={t("yourAnswer")}
                  rows={4}
                  className="w-full resize-y rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-deniz/50"
                />
                {!revealedAnswer[item.id] ? (
                  <button
                    onClick={showAnswer}
                    className="mt-3 rounded-full bg-deniz px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
                  >
                    {t("showAnswer")}
                  </button>
                ) : (
                  <div className="rise-in mt-3 space-y-3">
                    <div className="rounded-xl border border-moss/25 bg-moss-soft px-4 py-3">
                      <Md className="text-sm">{bi(item.answer)}</Md>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => selfGrade(true)}
                        className="rounded-full border border-moss/40 bg-moss-soft px-3 py-1.5 text-sm font-semibold text-moss transition-colors hover:border-moss"
                      >
                        {t("hadIt")}
                      </button>
                      <button
                        onClick={() => selfGrade(false)}
                        className="rounded-full border border-clay/40 bg-clay-soft px-3 py-1.5 text-sm font-semibold text-clay transition-colors hover:border-clay"
                      >
                        {t("missedIt")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* navigation */}
          <div className="flex items-center justify-between gap-2">
            <button
              disabled={current === 0}
              onClick={() => setCurrent((c) => c - 1)}
              className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-deniz/40 disabled:opacity-40"
            >
              ←
            </button>
            <div className="flex items-center gap-1 text-xs text-ink-faint">
              <span>
                {t("jumpTo")}:
              </span>
              <input
                type="number"
                min={1}
                max={total}
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && jumpTo()}
                className="w-14 rounded-lg border border-line bg-card px-2 py-1 text-center text-sm"
                placeholder={`${current + 1}`}
              />
            </div>
            <button
              disabled={current === total - 1}
              onClick={() => setCurrent((c) => c + 1)}
              className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-deniz/40 disabled:opacity-40"
            >
              →
            </button>
          </div>

          {/* compact dot strip grouped in tens */}
          <div className="space-y-1">
            {groups.map((g, gi) => (
              <div key={gi} className="flex flex-wrap gap-1">
                {g.map((i) => {
                  const it = filtered[i];
                  const p = state.practice[`${subject}/${unit.slug}/${it.id}`];
                  return (
                    <button
                      key={it.id}
                      onClick={() => setCurrent(i)}
                      aria-label={`question ${i + 1}`}
                      className={`h-2.5 w-2.5 rounded-full transition-colors ${
                        i === current
                          ? "bg-deniz"
                          : !p?.answered
                            ? "bg-line"
                            : p.correct === false
                              ? "bg-clay"
                              : "bg-moss"
                      }`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
