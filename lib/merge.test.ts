import { describe, it, expect } from "vitest";
import { mergeStates, type SyncState } from "./merge";

const base = (): SyncState => ({ progress: { q: {}, quiz: {}, practice: {} }, decks: {} });

describe("mergeStates (union-merge, never lose progress)", () => {
  it("keeps the higher step and OR-s done", () => {
    const a = base(); a.progress.q["hidroloji/q1"] = { step: 3, done: false };
    const b = base(); b.progress.q["hidroloji/q1"] = { step: 1, done: true };
    const m = mergeStates(a, b);
    expect(m.progress.q["hidroloji/q1"]).toEqual({ step: 3, done: true });
  });

  it("keeps the higher quiz score", () => {
    const a = base(); a.progress.quiz["hidroloji/u1"] = { score: 4, total: 5 };
    const b = base(); b.progress.quiz["hidroloji/u1"] = { score: 2, total: 5 };
    expect(mergeStates(a, b).progress.quiz["hidroloji/u1"]).toEqual({ score: 4, total: 5 });
  });

  it("OR-s practice answered and prefers a defined correctness", () => {
    const a = base(); a.progress.practice["s/u/p"] = { answered: true, correct: false };
    const b = base(); b.progress.practice["s/u/p"] = { answered: false };
    const m = mergeStates(a, b);
    expect(m.progress.practice["s/u/p"].answered).toBe(true);
    expect(m.progress.practice["s/u/p"].correct).toBe(false);
  });

  it("unions decks; most recent grading wins, tie -> higher box", () => {
    const a = base(); a.decks["hidroloji:d"] = { c1: { box: 2, last: 100 } };
    const b = base(); b.decks["hidroloji:d"] = { c1: { box: 4, last: 50 }, c2: { box: 1, last: 10 } };
    const m = mergeStates(a, b);
    expect(m.decks["hidroloji:d"].c1).toEqual({ box: 2, last: 100 }); // newer last wins
    expect(m.decks["hidroloji:d"].c2).toEqual({ box: 1, last: 10 });  // union keeps b-only
  });

  it("is side-effect free (no window access) so it runs under node", () => {
    expect(() => mergeStates(base(), base())).not.toThrow();
  });
});
