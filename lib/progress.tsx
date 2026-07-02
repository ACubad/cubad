"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface QuestionProgress {
  /** number of steps the student has revealed */
  step: number;
  done: boolean;
}

interface ProgressState {
  q: Record<string, QuestionProgress>;
  quiz: Record<string, { score: number; total: number }>;
}

interface ProgressCtx {
  state: ProgressState;
  setStep: (id: string, step: number) => void;
  markDone: (id: string, done?: boolean) => void;
  setQuizScore: (slug: string, score: number, total: number) => void;
}

const EMPTY: ProgressState = { q: {}, quiz: {} };
const KEY = "cubad:progress:v1";

const Ctx = createContext<ProgressCtx>({
  state: EMPTY,
  setStep: () => {},
  markDone: () => {},
  setQuizScore: () => {},
});

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProgressState>(EMPTY);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setState(JSON.parse(raw) as ProgressState);
    } catch {
      /* corrupted storage — start fresh */
    }
  }, []);

  const persist = useCallback((next: ProgressState) => {
    setState(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage full or blocked — progress just won't persist */
    }
  }, []);

  const setStep = useCallback(
    (id: string, step: number) => {
      setState((prev) => {
        const cur = prev.q[id] ?? { step: 0, done: false };
        if (step <= cur.step) return prev;
        const next = {
          ...prev,
          q: { ...prev.q, [id]: { ...cur, step } },
        };
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    []
  );

  const markDone = useCallback(
    (id: string, done = true) => {
      setState((prev) => {
        const cur = prev.q[id] ?? { step: 0, done: false };
        const next = { ...prev, q: { ...prev.q, [id]: { ...cur, done } } };
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    []
  );

  const setQuizScore = useCallback(
    (slug: string, score: number, total: number) => {
      setState((prev) => {
        const next = {
          ...prev,
          quiz: { ...prev.quiz, [slug]: { score, total } },
        };
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    []
  );

  return (
    <Ctx.Provider value={{ state, setStep, markDone, setQuizScore }}>
      {children}
    </Ctx.Provider>
  );
}

export function useProgress() {
  return useContext(Ctx);
}
