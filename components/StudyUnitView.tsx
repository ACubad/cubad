"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { useProgress } from "@/lib/progress";
import type { Unit } from "@/lib/types";
import { Md } from "./Md";
import { GraphStory } from "./GraphStory";
import { WaterProgress, DifficultyDots, LikelihoodBadge } from "./ui";
import { PodcastCard } from "./PodcastCard";
import { TutorPanel } from "./TutorPanel";

export function StudyUnitView({ subject, unit }: { subject: string; unit: Unit }) {
  const { t, bi } = useLang();
  const { state } = useProgress();

  const notes = unit.notes ?? [];
  const flashcards = unit.flashcards ?? [];
  const practice = unit.practice ?? [];
  const questions = unit.questions ?? [];
  const sources = unit.sources;

  const answered = practice.filter(
    (p) => state.practice[`${subject}/${unit.slug}/${p.id}`]?.answered
  ).length;
  const progressFraction = practice.length ? answered / practice.length : 0;

  // due-card count (mirrors FlashcardDeck's Leitner rule) for the action card
  let dueCount = flashcards.length;
  if (typeof window !== "undefined" && flashcards.length) {
    try {
      const raw = window.localStorage.getItem(`cubad:cards:${subject}:${unit.slug}`);
      if (raw) {
        const box: Record<string, { box: 1 | 2 | 3; last: number }> = JSON.parse(raw);
        const today = Math.floor(Date.now() / 86400000);
        dueCount = flashcards.filter((c) => {
          const rec = box[c.id];
          if (!rec) return true;
          if (rec.box === 1) return true;
          if (rec.box === 2) return today - rec.last >= 2;
          return today - rec.last >= 5;
        }).length;
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-8">
      {/* header */}
      <div className="rise-in">
        <Link
          href={`/s/${subject}`}
          className="text-sm font-medium text-deniz hover:text-deniz-deep"
        >
          ← {t("backToSubjects")}
        </Link>
        <p className="mt-2 font-mono text-xs font-semibold uppercase tracking-wider text-deniz">
          {t("unit")} · {String(unit.unit).padStart(2, "0")}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-deniz-deep sm:text-4xl">
          {bi(unit.title)}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-soft">{bi(unit.tagline)}</p>
        {practice.length > 0 && (
          <div className="mt-4 max-w-md">
            <div className="mb-1 flex justify-between text-xs font-medium text-ink-soft">
              <span>{t("progress")}</span>
              <span>
                {answered}/{practice.length}
              </span>
            </div>
            <WaterProgress value={progressFraction} />
          </div>
        )}
      </div>

      {/* podcast */}
      <PodcastCard subject={subject} unit={unit} />

      {/* notes / concept anlatimi with sticky mini-TOC on lg+ */}
      {notes.length > 0 && (
        <section className="lg:grid lg:grid-cols-[1fr_220px] lg:gap-8">
          <div className="space-y-4">
            <h2 className="font-display text-xl font-semibold text-ink">
              📖 {t("konuAnlatimi")}
            </h2>
            {notes.map((n) => (
              <div
                key={n.id}
                id={n.id}
                className="scroll-mt-24 rounded-2xl border border-line bg-card p-5 sm:p-6"
              >
                <h3 className="mb-3 font-display text-lg font-semibold text-ink">{bi(n.title)}</h3>
                <Md>{bi(n.body)}</Md>
                {n.story && (
                  <div className="mt-4">
                    <GraphStory story={n.story} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* sticky mini-toc, ≥lg only */}
          <aside className="hidden lg:block">
            <div className="sticky top-20 space-y-1 rounded-2xl border border-line bg-card p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                {t("konuAnlatimi")}
              </p>
              {notes.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className="block truncate rounded-lg px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-wash hover:text-deniz-deep"
                >
                  {bi(n.title)}
                </a>
              ))}
            </div>
          </aside>
        </section>
      )}

      {/* action cards: flashcards + practice */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`/s/${subject}/unit/${unit.slug}/cards`}
          className="group rounded-2xl border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"
        >
          <p className="text-2xl">🃏</p>
          <h3 className="mt-2 font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">
            {t("flashcardsTitle")}
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            {flashcards.length} {t("cardsCount")}
            {flashcards.length > 0 && ` · ${dueCount} ${t("dueCards")}`}
          </p>
        </Link>
        <Link
          href={`/s/${subject}/unit/${unit.slug}/practice`}
          className="group rounded-2xl border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"
        >
          <p className="text-2xl">❓</p>
          <h3 className="mt-2 font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">
            {t("practiceTitle")}
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            {practice.length} {t("questions")}
            {practice.length > 0 && ` · ${answered} ${t("answeredCount")}`}
          </p>
        </Link>
      </section>

      {/* step-by-step walkthroughs, if any */}
      {questions.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-xl font-semibold text-ink">
            {t("stepByStepSolutions")}
          </h2>
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
                    {p?.done ? "✓" : q.id}
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
      )}

      {/* sources footer */}
      {sources && (sources.videos.length > 0 || sources.pdfs.length > 0) && (
        <footer className="border-t border-line pt-5 text-xs text-ink-faint">
          <p className="mb-2 font-semibold uppercase tracking-wide">{t("resources")}</p>
          <ul className="space-y-1">
            {sources.videos.map((v) => (
              <li key={v.id}>
                <a
                  href={`https://www.youtube.com/watch?v=${v.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-deniz hover:text-deniz-deep hover:underline"
                >
                  {v.title}
                </a>{" "}
                <span className="text-ink-faint">({v.length})</span>
              </li>
            ))}
            {sources.pdfs.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </footer>
      )}

      <TutorPanel
        subject={subject}
        topicId={`${subject}/unit/${unit.slug}`}
        topicTitle={unit.title}
        context={JSON.stringify({
          type: "lesson-notes",
          unit: unit.title,
          notes: notes.map((n) => ({
            title: n.title,
            body: {
              tr: n.body.tr.slice(0, 1500),
              en: n.body.en.slice(0, 1500),
            },
          })),
        }).slice(0, 60000)}
      />
    </div>
  );
}
