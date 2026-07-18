/**
 * Pure, environment-agnostic study-state model + union-merge.
 * Extracted from lib/sync.ts so it can run in the browser, in Server Actions,
 * and in Vitest. NO window / localStorage access here.
 */

interface QuestionProgress { step: number; done: boolean; }
interface QuizScore { score: number; total: number; }
interface PracticeProgress { answered: boolean; correct?: boolean; }
interface ProgressState {
  q: Record<string, QuestionProgress>;
  quiz: Record<string, QuizScore>;
  practice: Record<string, PracticeProgress>;
}
interface LeitnerEntry { box: number; last: number; }
type Decks = Record<string, Record<string, LeitnerEntry>>;

interface ChatMsg { role: "user" | "model"; text: string; }
interface ChatConvo { id: string; createdAt: number; updatedAt?: number; messages: ChatMsg[]; }
interface ChatStore { convos: ChatConvo[]; activeId: string | null; }
type Chats = Record<string, ChatStore>;

export interface SyncState {
  progress: ProgressState;
  decks: Decks;
  chats?: Chats;
}
export type { ProgressState, LeitnerEntry, Decks };

export const SYNC_CONVOS_PER_TOPIC = 8;
export const SYNC_MSGS_PER_CONVO = 40;
export const EMPTY_PROGRESS: ProgressState = { q: {}, quiz: {}, practice: {} };

export function trimChats(store: ChatStore): ChatStore {
  const byRecency = [...store.convos].sort(
    (a, b) => (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt)
  );
  return {
    activeId: store.activeId,
    convos: byRecency
      .slice(-SYNC_CONVOS_PER_TOPIC)
      .map((c) => ({ ...c, messages: c.messages.slice(-SYNC_MSGS_PER_CONVO) })),
  };
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

  // chats: union conversations by id; a diverged conversation keeps its longer thread
  const mergedChats: Chats = {};
  for (const topic of new Set([
    ...Object.keys(local.chats ?? {}),
    ...Object.keys(remote.chats ?? {}),
  ])) {
    const a = local.chats?.[topic];
    const b = remote.chats?.[topic];
    if (!a || !b) {
      mergedChats[topic] = trimChats((a ?? b) as ChatStore);
      continue;
    }
    const byId = new Map<string, ChatConvo>();
    for (const c of [...b.convos, ...a.convos]) {
      const prev = byId.get(c.id);
      if (!prev) {
        byId.set(c.id, c);
      } else {
        const pick =
          c.messages.length !== prev.messages.length
            ? c.messages.length > prev.messages.length
              ? c
              : prev
            : (c.updatedAt ?? c.createdAt) >= (prev.updatedAt ?? prev.createdAt)
              ? c
              : prev;
        byId.set(c.id, pick);
      }
    }
    mergedChats[topic] = trimChats({
      convos: [...byId.values()].sort((x, y) => x.createdAt - y.createdAt),
      activeId: a.activeId ?? b.activeId,
    });
  }
  merged.chats = mergedChats;

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
      // most recent grading wins; tie -> the higher box
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
