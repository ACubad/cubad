"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { notifyStateChanged, SYNC_APPLIED_EVENT } from "./sync";

interface QuestionProgress {
  /** number of steps the student has revealed */
  step: number;
  done: boolean;
}

interface PracticeProgress {
  answered: boolean;
  correct?: boolean;
}

interface ProgressState {
  q: Record<string, QuestionProgress>;
  quiz: Record<string, { score: number; total: number }>;
  practice: Record<string, PracticeProgress>;
}

interface ProgressCtx {
  state: ProgressState;
  setStep: (subject: string, id: string, step: number) => void;
  markDone: (subject: string, id: string, done?: boolean) => void;
  setQuizScore: (subject: string, slug: string, score: number, total: number) => void;
  setPractice: (
    subject: string,
    unitSlug: string,
    qid: string,
    progress: PracticeProgress
  ) => void;
}

const EMPTY: ProgressState = { q: {}, quiz: {}, practice: {} };
const KEY_V2 = "cubad:progress:v2";
const KEY_V1 = "cubad:progress:v1";

const Ctx = createContext<ProgressCtx>({
  state: EMPTY,
  setStep: () => {},
  markDone: () => {},
  setQuizScore: () => {},
  setPractice: () => {},
});

function loadMigrated(): ProgressState {
  try {
    const rawV2 = window.localStorage.getItem(KEY_V2);
    if (rawV2) return JSON.parse(rawV2) as ProgressState;

    const rawV1 = window.localStorage.getItem(KEY_V1);
    if (rawV1) {
      const v1 = JSON.parse(rawV1) as {
        q?: Record<string, QuestionProgress>;
        quiz?: Record<string, { score: number; total: number }>;
      };
      const migrated: ProgressState = { q: {}, quiz: {}, practice: {} };
      for (const [k, v] of Object.entries(v1.q ?? {})) {
        migrated.q[k.includes("/") ? k : `hidroloji/${k}`] = v;
      }
      for (const [k, v] of Object.entries(v1.quiz ?? {})) {
        migrated.quiz[k.includes("/") ? k : `hidroloji/${k}`] = v;
      }
      window.localStorage.setItem(KEY_V2, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    /* corrupted storage — start fresh */
  }
  return EMPTY;
}

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProgressState>(EMPTY);

  useEffect(() => {
    setState(loadMigrated());
    // when cross-device sync merges remote progress into localStorage, reload it
    const onSyncApplied = () => setState(loadMigrated());
    window.addEventListener(SYNC_APPLIED_EVENT, onSyncApplied);
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, onSyncApplied);
  }, []);

  const setStep = useCallback(
    (subject: string, id: string, step: number) => {
      const key = `${subject}/${id}`;
      setState((prev) => {
        const cur = prev.q[key] ?? { step: 0, done: false };
        if (step <= cur.step) return prev;
        const next = {
          ...prev,
          q: { ...prev.q, [key]: { ...cur, step } },
        };
        try {
          window.localStorage.setItem(KEY_V2, JSON.stringify(next));
          notifyStateChanged();
        } catch {}
        return next;
      });
    },
    []
  );

  const markDone = useCallback(
    (subject: string, id: string, done = true) => {
      const key = `${subject}/${id}`;
      setState((prev) => {
        const cur = prev.q[key] ?? { step: 0, done: false };
        const next = { ...prev, q: { ...prev.q, [key]: { ...cur, done } } };
        try {
          window.localStorage.setItem(KEY_V2, JSON.stringify(next));
          notifyStateChanged();
        } catch {}
        return next;
      });
    },
    []
  );

  const setQuizScore = useCallback(
    (subject: string, slug: string, score: number, total: number) => {
      const key = `${subject}/${slug}`;
      setState((prev) => {
        const next = {
          ...prev,
          quiz: { ...prev.quiz, [key]: { score, total } },
        };
        try {
          window.localStorage.setItem(KEY_V2, JSON.stringify(next));
          notifyStateChanged();
        } catch {}
        return next;
      });
    },
    []
  );

  const setPractice = useCallback(
    (subject: string, unitSlug: string, qid: string, progress: PracticeProgress) => {
      const key = `${subject}/${unitSlug}/${qid}`;
      setState((prev) => {
        const next = {
          ...prev,
          practice: { ...prev.practice, [key]: progress },
        };
        try {
          window.localStorage.setItem(KEY_V2, JSON.stringify(next));
          notifyStateChanged();
        } catch {}
        return next;
      });
    },
    []
  );

  return (
    <Ctx.Provider value={{ state, setStep, markDone, setQuizScore, setPractice }}>
      {children}
    </Ctx.Provider>
  );
}

export function useProgress() {
  return useContext(Ctx);
}
