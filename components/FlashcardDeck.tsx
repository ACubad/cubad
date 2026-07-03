"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import type { Flashcard, Unit } from "@/lib/types";
import { Md } from "./Md";

type Box = 1 | 2 | 3;
interface LeitnerRecord {
  box: Box;
  last: number; // epoch days
}
type LeitnerState = Record<string, LeitnerRecord>;

function todayEpochDays() {
  return Math.floor(Date.now() / 86400000);
}

function storageKey(subject: string, unitSlug: string) {
  return `cubad:cards:${subject}:${unitSlug}`;
}

function loadLeitner(subject: string, unitSlug: string): LeitnerState {
  try {
    const raw = window.localStorage.getItem(storageKey(subject, unitSlug));
    return raw ? (JSON.parse(raw) as LeitnerState) : {};
  } catch {
    return {};
  }
}

function saveLeitner(subject: string, unitSlug: string, state: LeitnerState) {
  try {
    window.localStorage.setItem(storageKey(subject, unitSlug), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function isDue(rec: LeitnerRecord | undefined, today: number): boolean {
  if (!rec) return true;
  if (rec.box === 1) return true;
  if (rec.box === 2) return today - rec.last >= 2;
  return today - rec.last >= 5;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function FlashcardDeck({ subject, unit }: { subject: string; unit: Unit }) {
  const { t, bi } = useLang();
  const cards = useMemo(() => unit.flashcards ?? [], [unit.flashcards]);
  const allTags = useMemo(
    () => Array.from(new Set(cards.map((c) => c.tag))).sort(),
    [cards]
  );

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [dueOnly, setDueOnly] = useState(true);
  const [leitner, setLeitner] = useState<LeitnerState>({});
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showEn, setShowEn] = useState(false);
  const [finished, setFinished] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // load persisted leitner state
  useEffect(() => {
    setLeitner(loadLeitner(subject, unit.slug));
    setLoaded(true);
  }, [subject, unit.slug]);

  const filteredCards = useMemo(() => {
    let list = cards;
    if (selectedTags.length) list = list.filter((c) => selectedTags.includes(c.tag));
    return list;
  }, [cards, selectedTags]);

  const buildQueue = useCallback(() => {
    const today = todayEpochDays();
    let pool = filteredCards;
    if (dueOnly) pool = pool.filter((c) => isDue(leitner[c.id], today));
    setQueue(shuffle(pool));
    setPos(0);
    setFlipped(false);
    setShowEn(false);
    setFinished(pool.length === 0);
  }, [filteredCards, dueOnly, leitner]);

  useEffect(() => {
    if (!loaded) return;
    buildQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selectedTags, dueOnly]);

  const current = queue[pos];

  const grade = useCallback(
    (result: "again" | "good" | "easy") => {
      if (!current) return;
      const today = todayEpochDays();
      setLeitner((prev) => {
        const cur = prev[current.id] ?? { box: 1 as Box, last: today };
        let box: Box = cur.box;
        if (result === "again") box = 1;
        else if (result === "good") box = Math.min(3, cur.box + 1) as Box;
        else box = 3;
        const next = { ...prev, [current.id]: { box, last: today } };
        saveLeitner(subject, unit.slug, next);
        return next;
      });
      if (pos + 1 >= queue.length) {
        setFinished(true);
      } else {
        setPos((p) => p + 1);
        setFlipped(false);
        setShowEn(false);
      }
    },
    [current, pos, queue.length, subject, unit.slug]
  );

  const next = useCallback(() => {
    if (pos + 1 >= queue.length) return;
    setPos((p) => p + 1);
    setFlipped(false);
    setShowEn(false);
  }, [pos, queue.length]);

  const prev = useCallback(() => {
    if (pos === 0) return;
    setPos((p) => p - 1);
    setFlipped(false);
    setShowEn(false);
  }, [pos]);

  // keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || !current) return;
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") {
        next();
      } else if (e.key === "ArrowLeft") {
        prev();
      } else if (flipped && (e.key === "1" || e.key === "2" || e.key === "3")) {
        grade(e.key === "1" ? "again" : e.key === "2" ? "good" : "easy");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finished, current, flipped, next, prev, grade]);

  const boxCounts = useMemo(() => {
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const c of cards) {
      const b = leitner[c.id]?.box ?? 1;
      counts[b]++;
    }
    return counts;
  }, [cards, leitner]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t2) => t2 !== tag) : [...prev, tag]
    );
  };

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
          🃏 {t("flashcardsTitle")}
        </h1>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        {allTags.map((tag) => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              selectedTags.includes(tag)
                ? "border-deniz bg-deniz text-white"
                : "border-line bg-card text-ink-soft hover:border-deniz/40"
            }`}
          >
            {tag}
          </button>
        ))}
        <button
          onClick={() => setDueOnly((d) => !d)}
          className={`ml-auto rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
            dueOnly
              ? "border-amber bg-amber-soft text-amber"
              : "border-line bg-card text-ink-soft hover:border-deniz/40"
          }`}
        >
          {t("dueOnly")}
        </button>
      </div>

      {/* header: position + box distribution */}
      {!finished && current && (
        <div className="flex items-center justify-between text-xs font-semibold text-ink-soft">
          <span>
            {pos + 1}/{queue.length}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-ink-faint">
              {t("box")} 1: {boxCounts[1]}
            </span>
            <span className="text-ink-faint">
              {t("box")} 2: {boxCounts[2]}
            </span>
            <span className="text-ink-faint">
              {t("box")} 3: {boxCounts[3]}
            </span>
          </div>
        </div>
      )}

      {/* card */}
      {!finished && current ? (
        <div className="mx-auto w-full max-w-xl">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setFlipped((f) => !f)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setFlipped((f) => !f);
            }}
            className="relative h-64 w-full cursor-pointer select-none"
            style={{ perspective: "1200px" }}
          >
            <div
              className="relative h-full w-full rounded-2xl transition-transform duration-[400ms]"
              style={{
                transformStyle: "preserve-3d",
                transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              }}
            >
              {/* front */}
              <div
                className="absolute inset-0 flex items-center justify-center rounded-2xl border border-line bg-card p-6 text-center"
                style={{ backfaceVisibility: "hidden" }}
              >
                <p className="font-display text-2xl font-semibold text-ink">
                  {bi(current.front)}
                </p>
              </div>
              {/* back */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto rounded-2xl border border-deniz/30 bg-deniz-soft p-6 text-center"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              >
                <div className="text-[0.95rem] text-ink">
                  <Md>{bi(current.back)}</Md>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowEn((s) => !s);
                  }}
                  className="rounded-full border border-amber/40 bg-amber-soft px-3 py-1 text-xs font-semibold text-amber transition-colors hover:border-amber"
                >
                  {t("showEnglish")}
                </button>
                {showEn && (
                  <div className="rise-in rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber">
                    {current.en}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* grade bar */}
          {flipped && (
            <div className="rise-in mt-4 grid grid-cols-3 gap-2">
              <button
                onClick={() => grade("again")}
                className="rounded-xl border border-clay/40 bg-clay-soft px-3 py-2 text-sm font-semibold text-clay transition-colors hover:border-clay"
              >
                {t("gradeAgain")} <span className="text-ink-faint">(1)</span>
              </button>
              <button
                onClick={() => grade("good")}
                className="rounded-xl border border-deniz/40 bg-deniz-soft px-3 py-2 text-sm font-semibold text-deniz transition-colors hover:border-deniz"
              >
                {t("gradeGood")} <span className="text-ink-faint">(2)</span>
              </button>
              <button
                onClick={() => grade("easy")}
                className="rounded-xl border border-moss/40 bg-moss-soft px-3 py-2 text-sm font-semibold text-moss transition-colors hover:border-moss"
              >
                {t("gradeEasy")} <span className="text-ink-faint">(3)</span>
              </button>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={prev}
              disabled={pos === 0}
              className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-deniz/40 disabled:opacity-40"
            >
              ←
            </button>
            <button
              onClick={() => setFlipped((f) => !f)}
              className="rounded-full bg-deniz px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              {t("flipCard")}
            </button>
            <button
              onClick={next}
              disabled={pos + 1 >= queue.length}
              className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-deniz/40 disabled:opacity-40"
            >
              →
            </button>
          </div>
        </div>
      ) : (
        <div className="rise-in rounded-2xl border border-moss/30 bg-moss-soft p-6 text-center">
          <p className="font-display text-xl font-semibold text-moss">
            {queue.length === 0 ? t("noCardsDue") : t("deckComplete")}
          </p>
          <div className="mt-3 flex justify-center gap-3">
            <button
              onClick={buildQueue}
              className="rounded-full border border-moss/40 px-4 py-2 text-sm font-semibold text-moss transition-colors hover:bg-moss/10"
            >
              {t("restartDeck")}
            </button>
            <Link
              href={`/s/${subject}/unit/${unit.slug}`}
              className="rounded-full bg-deniz px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              {t("backToUnit")}
            </Link>
          </div>
          <div className="mt-4 flex justify-center gap-3 text-xs text-ink-faint">
            <span>
              {t("box")} 1: {boxCounts[1]}
            </span>
            <span>
              {t("box")} 2: {boxCounts[2]}
            </span>
            <span>
              {t("box")} 3: {boxCounts[3]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
