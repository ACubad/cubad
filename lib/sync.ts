"use client";

/**
 * Cross-device sync of study state (progress + flashcard boxes) through the
 * /api/sync route (backed by the user's Supabase project).
 *
 * Strategy: the sync code lives in localStorage. On load and after every local
 * change (debounced), we PULL the server state, MERGE it with local state
 * (element-wise, never losing progress from either side), APPLY the merge
 * locally, and PUSH it back.
 */

export const SYNC_CODE_KEY = "cubad:sync:code";
export const SYNC_LAST_KEY = "cubad:sync:last";
export const STATE_CHANGED_EVENT = "cubad:state-changed";
export const SYNC_APPLIED_EVENT = "cubad:sync-applied";

const PROGRESS_KEY = "cubad:progress:v2";
const DECK_PREFIX = "cubad:cards:";

interface QuestionProgress {
  step: number;
  done: boolean;
}
interface QuizScore {
  score: number;
  total: number;
}
interface PracticeProgress {
  answered: boolean;
  correct?: boolean;
}
interface ProgressState {
  q: Record<string, QuestionProgress>;
  quiz: Record<string, QuizScore>;
  practice: Record<string, PracticeProgress>;
}
interface LeitnerEntry {
  box: number;
  last: number;
}
type Decks = Record<string, Record<string, LeitnerEntry>>;

export interface SyncState {
  progress: ProgressState;
  decks: Decks;
}

const EMPTY_PROGRESS: ProgressState = { q: {}, quiz: {}, practice: {} };

export function getSyncCode(): string {
  try {
    return window.localStorage.getItem(SYNC_CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function gatherState(): SyncState {
  let progress = EMPTY_PROGRESS;
  const decks: Decks = {};
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (raw) progress = JSON.parse(raw) as ProgressState;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(DECK_PREFIX)) {
        try {
          decks[k.slice(DECK_PREFIX.length)] = JSON.parse(
            window.localStorage.getItem(k) ?? "{}"
          ) as Record<string, LeitnerEntry>;
        } catch {
          /* skip corrupted deck */
        }
      }
    }
  } catch {
    /* SSR or blocked storage */
  }
  return { progress, decks };
}

/** Union-merge: never lose progress from either side. */
export function mergeStates(local: SyncState, remote: SyncState): SyncState {
  const merged: SyncState = {
    progress: { q: {}, quiz: {}, practice: {} },
    decks: {},
  };

  const rp = remote.progress ?? EMPTY_PROGRESS;
  const lp = local.progress ?? EMPTY_PROGRESS;

  for (const k of new Set([...Object.keys(lp.q ?? {}), ...Object.keys(rp.q ?? {})])) {
    const a = lp.q?.[k];
    const b = rp.q?.[k];
    merged.progress.q[k] = {
      step: Math.max(a?.step ?? 0, b?.step ?? 0),
      done: Boolean(a?.done || b?.done),
    };
  }
  for (const k of new Set([...Object.keys(lp.quiz ?? {}), ...Object.keys(rp.quiz ?? {})])) {
    const a = lp.quiz?.[k];
    const b = rp.quiz?.[k];
    merged.progress.quiz[k] = !a ? b! : !b ? a : a.score >= b.score ? a : b;
  }
  for (const k of new Set([
    ...Object.keys(lp.practice ?? {}),
    ...Object.keys(rp.practice ?? {}),
  ])) {
    const a = lp.practice?.[k];
    const b = rp.practice?.[k];
    merged.progress.practice[k] = {
      answered: Boolean(a?.answered || b?.answered),
      correct: a?.correct ?? b?.correct,
    };
  }

  for (const deck of new Set([
    ...Object.keys(local.decks ?? {}),
    ...Object.keys(remote.decks ?? {}),
  ])) {
    const a = local.decks?.[deck] ?? {};
    const b = remote.decks?.[deck] ?? {};
    const out: Record<string, LeitnerEntry> = {};
    for (const card of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const ea = a[card];
      const eb = b[card];
      // most recent grading wins; tie → the higher box
      out[card] = !ea
        ? eb!
        : !eb
          ? ea
          : ea.last > eb.last
            ? ea
            : eb.last > ea.last
              ? eb
              : ea.box >= eb.box
                ? ea
                : eb;
    }
    merged.decks[deck] = out;
  }

  return merged;
}

export function applyState(state: SyncState): void {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
    for (const [deck, cards] of Object.entries(state.decks)) {
      window.localStorage.setItem(DECK_PREFIX + deck, JSON.stringify(cards));
    }
  } catch {
    /* storage blocked */
  }
}

/** Pull remote, merge with local, apply locally, push merged. */
export async function syncNow(): Promise<{ ok: boolean; mergedFromRemote: boolean }> {
  const code = getSyncCode();
  if (!code) return { ok: false, mergedFromRemote: false };

  const pull = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!pull.ok) return { ok: false, mergedFromRemote: false };
  const remote = (await pull.json()) as { state: SyncState | null };

  const local = gatherState();
  const merged = remote.state ? mergeStates(local, remote.state) : local;
  applyState(merged);

  const push = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state: merged }),
  });
  if (push.ok) {
    try {
      window.localStorage.setItem(SYNC_LAST_KEY, String(Date.now()));
    } catch {}
    window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
  }
  return { ok: push.ok, mergedFromRemote: Boolean(remote.state) };
}

/** Notify the sync manager that local study state changed. */
export function notifyStateChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(STATE_CHANGED_EVENT));
  } catch {
    /* SSR */
  }
}
