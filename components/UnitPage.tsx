"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { useProgress } from "@/lib/progress";
import { canPersistStudyState } from "@/lib/sync";
import type { SubjectMeta, Unit } from "@/lib/types";
import { GraphStory } from "./GraphStory";
import { Md, Tex } from "./Md";
import { PodcastCard } from "./PodcastCard";
import { TutorPanel } from "./TutorPanel";
import { Callout, DifficultyDots, LikelihoodBadge, WaterProgress } from "./ui";

export function UnitPage({ subject, unit }: { subject: SubjectMeta; unit: Unit }) {
  const { t, bi } = useLang();
  const { state } = useProgress();
  const isWalkthrough = subject.section_order === "walkthrough";
  const questions = unit.questions ?? [];
  const notes = unit.notes ?? [];
  const flashcards = unit.flashcards ?? [];
  const practice = unit.practice ?? [];
  const sources = unit.sources;
  const concept = unit.concept;
  const doneQuestions = questions.filter((question) => state.q[`${subject.slug}/${question.id}`]?.done).length;
  const quizScore = state.quiz[`${subject.slug}/${unit.slug}`];
  const answeredPractice = practice.filter(
    (item) => state.practice[`${subject.slug}/${unit.slug}/${item.id}`]?.answered
  ).length;

  let dueCount = flashcards.length;
  if (typeof window !== "undefined" && canPersistStudyState() && flashcards.length) {
    try {
      const raw = window.localStorage.getItem(`cubad:cards:${subject.slug}:${unit.slug}`);
      if (raw) {
        const boxes: Record<string, { box: 1 | 2 | 3; last: number }> = JSON.parse(raw);
        const today = Math.floor(Date.now() / 86400000);
        dueCount = flashcards.filter((card) => {
          const record = boxes[card.id];
          if (!record || record.box === 1) return true;
          return record.box === 2 ? today - record.last >= 2 : today - record.last >= 5;
        }).length;
      }
    } catch {
      /* corrupted local Leitner state is non-fatal */
    }
  }

  const tutorContext = concept
    ? JSON.stringify({
        type: "unit-primer",
        unit: unit.title,
        overview: concept.overview,
        keyFormulas: concept.keyFormulas.map((formula) => ({
          name: formula.name,
          latex: formula.latex,
          meaning: formula.meaning,
          whenToUse: formula.whenToUse,
        })),
        traps: concept.traps,
        questions: questions.map((question) => ({ id: question.id, code: question.code, title: question.title })),
      }).slice(0, 60000)
    : JSON.stringify({
        type: "lesson-notes",
        unit: unit.title,
        notes: notes.map((note) => ({
          title: note.title,
          body: { tr: note.body.tr.slice(0, 1500), en: note.body.en.slice(0, 1500) },
        })),
      }).slice(0, 60000);

  const header = (
    <div className="rise-in">
      {!isWalkthrough && (
        <Link href={`/s/${subject.slug}`} className="text-sm font-medium text-deniz hover:text-deniz-deep">
          ← {t("backToSubjects")}
        </Link>
      )}
      <p className={`${!isWalkthrough ? "mt-2 " : ""}font-mono text-xs font-semibold uppercase tracking-wider text-deniz`}>
        {isWalkthrough ? t("units") : t("unit")} · {String(unit.unit).padStart(2, "0")}
      </p>
      <h1 className="mt-1 font-display text-3xl font-semibold text-deniz-deep sm:text-4xl">{bi(unit.title)}</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">{bi(unit.tagline)}</p>
      {isWalkthrough ? (
        <div className="mt-4 max-w-md">
          <div className="mb-1 flex justify-between text-xs font-medium text-ink-soft"><span>{t("progress")}</span><span>{doneQuestions}/{questions.length}</span></div>
          <WaterProgress value={questions.length ? doneQuestions / questions.length : 0} />
        </div>
      ) : practice.length > 0 ? (
        <div className="mt-4 max-w-md">
          <div className="mb-1 flex justify-between text-xs font-medium text-ink-soft"><span>{t("progress")}</span><span>{answeredPractice}/{practice.length}</span></div>
          <WaterProgress value={answeredPractice / practice.length} />
        </div>
      ) : null}
    </div>
  );

  const conceptSection = concept && (
    <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
      <h2 className="mb-3 font-display text-xl font-semibold text-ink">{t("conceptPrimer")}</h2>
      <Md>{bi(concept.overview)}</Md>
      {concept.keyFormulas.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("keyFormulas")}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {concept.keyFormulas.map((formula, index) => (
              <div key={index} className="min-w-0 rounded-xl border border-line-soft bg-paper p-4">
                <p className="mb-1 text-sm font-semibold text-deniz-deep">{bi(formula.name)}</p>
                <div className="overflow-x-auto py-1"><Tex tex={formula.latex} /></div>
                <Md className="mt-1 !text-[13px] text-ink-soft [&_p]:leading-relaxed">{bi(formula.meaning)}</Md>
                <div className="mt-2 text-[13px]"><span className="font-semibold text-deniz">{t("whenToUse")}: </span><Md className="!text-[13px] inline text-ink-soft [&_p]:inline">{bi(formula.whenToUse)}</Md></div>
              </div>
            ))}
          </div>
        </>
      )}
      {concept.traps.length > 0 && (
        <div className="mt-6"><Callout kind="trap" title={t("traps")}><ul className="list-disc space-y-1 pl-4">{concept.traps.map((trap, index) => <li key={index}><Md className="[&_p]:inline">{bi(trap)}</Md></li>)}</ul></Callout></div>
      )}
    </section>
  );

  const questionsSection = questions.length > 0 && (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">{isWalkthrough ? t("questions").charAt(0).toUpperCase() + t("questions").slice(1) : t("stepByStepSolutions")}</h2>
        {(unit.quiz?.length ?? 0) > 0 && (
          <Link href={`/s/${subject.slug}/unit/${unit.slug}/quiz`} className="rounded-full bg-deniz px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep">
            {t("quiz")}{quizScore ? ` · ${quizScore.score}/${quizScore.total}` : ""}
          </Link>
        )}
      </div>
      <div className="grid gap-2.5">
        {questions.map((question) => {
          const progress = state.q[`${subject.slug}/${question.id}`];
          const started = (progress?.step ?? 0) > 0;
          return (
            <Link key={question.id} href={`/s/${subject.slug}/q/${question.id}`} className="group flex min-w-0 items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 transition-all hover:border-deniz/40 hover:shadow-[0_4px_16px_rgba(14,90,109,0.08)] sm:gap-4">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold ${progress?.done ? "bg-moss text-white" : started ? "bg-deniz-soft text-deniz-deep" : "bg-wash text-ink-soft"}`}>
                {progress?.done ? "✓" : isWalkthrough ? question.id.split("-").slice(-1)[0] ? question.code.replace("Uygulama ", "") : question.id : question.id}
              </span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink group-hover:text-deniz-deep">{bi(question.title)}</span><span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-faint"><DifficultyDots level={question.difficulty} /><span>{question.steps.length} {t("step").toLowerCase()}</span>{question.examLikelihood === "high" && <LikelihoodBadge level="high" />}</span></span>
              <span className="shrink-0 text-sm font-semibold text-deniz"><span className="hidden sm:inline">{progress?.done ? t("review") : started ? t("continueWalkthrough") : t("startWalkthrough")}</span><span aria-hidden> →</span></span>
            </Link>
          );
        })}
      </div>
    </section>
  );

  const podcastSection = <PodcastCard subject={subject.slug} unit={unit} />;
  const notesSection = notes.length > 0 && (
    <section className="lg:grid lg:grid-cols-[1fr_220px] lg:gap-8">
      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold text-ink">📖 {t("konuAnlatimi")}</h2>
        {notes.map((note) => <div key={note.id} id={note.id} className="scroll-mt-24 rounded-2xl border border-line bg-card p-5 sm:p-6"><h3 className="mb-3 font-display text-lg font-semibold text-ink">{bi(note.title)}</h3><Md>{bi(note.body)}</Md>{note.story && <div className="mt-4"><GraphStory story={note.story} /></div>}</div>)}
      </div>
      <aside className="hidden lg:block"><div className="sticky top-20 space-y-1 rounded-2xl border border-line bg-card p-4"><p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("konuAnlatimi")}</p>{notes.map((note) => <a key={note.id} href={`#${note.id}`} className="block truncate rounded-lg px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-wash hover:text-deniz-deep">{bi(note.title)}</a>)}</div></aside>
    </section>
  );

  const actionCards = (flashcards.length > 0 || practice.length > 0) && (
    <section className="grid gap-4 sm:grid-cols-2">
      {flashcards.length > 0 && <Link href={`/s/${subject.slug}/unit/${unit.slug}/cards`} className="group rounded-2xl border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"><p className="text-2xl">🃏</p><h3 className="mt-2 font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">{t("flashcardsTitle")}</h3><p className="mt-1 text-sm text-ink-soft">{flashcards.length} {t("cardsCount")} · {dueCount} {t("dueCards")}</p></Link>}
      {practice.length > 0 && <Link href={`/s/${subject.slug}/unit/${unit.slug}/practice`} className="group rounded-2xl border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"><p className="text-2xl">❓</p><h3 className="mt-2 font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">{t("practiceTitle")}</h3><p className="mt-1 text-sm text-ink-soft">{practice.length} {t("questions")} · {answeredPractice} {t("answeredCount")}</p></Link>}
    </section>
  );

  const sourcesSection = sources && (sources.videos.length > 0 || sources.pdfs.length > 0) && (
    <footer className="border-t border-line pt-5 text-xs text-ink-faint"><p className="mb-2 font-semibold uppercase tracking-wide">{t("resources")}</p><ul className="space-y-1">{sources.videos.map((video) => <li key={video.id}><a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" className="text-deniz hover:text-deniz-deep hover:underline">{video.title}</a>{" "}<span className="text-ink-faint">({video.length})</span></li>)}{sources.pdfs.map((pdf) => <li key={pdf}>{pdf}</li>)}</ul></footer>
  );

  return (
    <div className="space-y-8">
      {header}
      {isWalkthrough ? <>{conceptSection}{questionsSection}{podcastSection}{notesSection}{actionCards}</> : <>{podcastSection}{notesSection}{actionCards}{conceptSection}{questionsSection}</>}
      {sourcesSection}
      <TutorPanel subject={subject.slug} topicId={`${subject.slug}/unit/${unit.slug}`} topicTitle={unit.title} context={tutorContext} />
    </div>
  );
}
