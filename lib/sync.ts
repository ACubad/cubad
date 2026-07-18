"use client";

/**
 * Authenticated cross-device study-state sync (progress, flashcard boxes, and
 * tutor histories) through /api/state.
 *
 * On sign-in, page load, and after local study-state changes, we pull the
 * account state, union-merge it with the device state, apply it locally, then
 * write the merged result back for the user's other signed-in devices.
 */

import {
  EMPTY_PROGRESS,
  mergeStates,
  trimChats,
  type SyncState,
  type ProgressState,
  type LeitnerEntry,
} from "./merge";
import { createClient } from "@/lib/supabase/browser";

// Re-export so existing importers of `SyncState` from "./sync" keep working.
export type { SyncState } from "./merge";
export { mergeStates } from "./merge";

export const SYNC_LAST_KEY = "cubad:sync:last";
export const SYNC_ACCOUNT_KEY = "cubad:sync:account-id";
export const STATE_CHANGED_EVENT = "cubad:state-changed";
export const SYNC_APPLIED_EVENT = "cubad:sync-applied";

const PROGRESS_KEY = "cubad:progress:v2";
const LEGACY_PROGRESS_KEY = "cubad:progress:v1";
const DECK_PREFIX = "cubad:cards:";
const CHAT_PREFIX = "cubad:chats:";
let stateOperation: Promise<void> = Promise.resolve();

function queueStateOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = stateOperation.then(operation, operation);
  stateOperation = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function clearStoredStudyState(): void {
  const keys: string[] = [];
  try {
    window.localStorage.removeItem(PROGRESS_KEY);
    window.localStorage.removeItem(LEGACY_PROGRESS_KEY);
    window.localStorage.removeItem(SYNC_LAST_KEY);
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(DECK_PREFIX) || key?.startsWith(CHAT_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* storage blocked */
  }
}

/**
 * Keep one browser profile from carrying account A's local state into account B.
 * Anonymous study state is intentionally claimed by the first account that signs
 * in; a different later account starts from its own remote state instead.
 */
function bindStoredStateToAccount(userId: string): void {
  try {
    const previousUserId = window.localStorage.getItem(SYNC_ACCOUNT_KEY);
    if (previousUserId && previousUserId !== userId) {
      clearStoredStudyState();
      window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
    }
    window.localStorage.setItem(SYNC_ACCOUNT_KEY, userId);
  } catch {
    /* storage blocked */
  }
}

/**
 * Remove the previous account's local projection immediately after sign-out.
 * A later anonymous visitor starts empty; a later sign-in pulls only that
 * account's state. The queue keeps this ordered after any in-flight sync.
 */
export function clearSignedOutStudyState(): Promise<void> {
  return queueStateOperation(async () => {
    clearStoredStudyState();
    try {
      window.localStorage.removeItem(SYNC_ACCOUNT_KEY);
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
  });
}

/** The signed-in Supabase user id, or null. Cheap: reads the local session. */
async function getAccountUserId(): Promise<string | null> {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export function gatherState(): SyncState {
  let progress = EMPTY_PROGRESS;
  const decks: Record<string, Record<string, LeitnerEntry>> = {};
  const chats: NonNullable<SyncState["chats"]> = {};
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
      } else if (k?.startsWith(CHAT_PREFIX)) {
        try {
          chats[k.slice(CHAT_PREFIX.length)] = trimChats(
            JSON.parse(window.localStorage.getItem(k) ?? "") as Parameters<typeof trimChats>[0]
          );
        } catch {
          /* skip corrupted chat store */
        }
      }
    }
  } catch {
    /* SSR or blocked storage */
  }
  return { progress, decks, chats };
}

export function applyState(state: SyncState): void {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
    for (const [deck, cards] of Object.entries(state.decks)) {
      window.localStorage.setItem(DECK_PREFIX + deck, JSON.stringify(cards));
    }
    for (const [topic, store] of Object.entries(state.chats ?? {})) {
      window.localStorage.setItem(CHAT_PREFIX + topic, JSON.stringify(store));
    }
  } catch {
    /* storage blocked */
  }
}

/** Pull remote, merge with local, apply locally, push merged. */
export async function syncNow(): Promise<{ ok: boolean; mergedFromRemote: boolean }> {
  return queueStateOperation(async () => {
    const userId = await getAccountUserId();
    if (!userId) return { ok: false, mergedFromRemote: false };
    return syncNowAccount(userId);
  });
}

async function syncNowAccount(userId: string): Promise<{ ok: boolean; mergedFromRemote: boolean }> {
  bindStoredStateToAccount(userId);
  const pull = await fetch("/api/state", { method: "GET" });
  if (!pull.ok) return { ok: false, mergedFromRemote: false };
  const remote = (await pull.json()) as {
    state: SyncState | null;
    updated_at: string | null;
  };

  // A sign-out/account switch while the request was in flight must never merge
  // the first account's local state into the account now represented by cookies.
  if ((await getAccountUserId()) !== userId) return { ok: false, mergedFromRemote: false };

  const local = gatherState();
  let merged = remote.state ? mergeStates(local, remote.state) : local;
  let baseUpdatedAt = remote.updated_at;
  let mergedFromRemote = Boolean(remote.state);
  applyState(merged);

  // A simultaneous write from another device returns its newer snapshot with a
  // 409. Union it into ours and retry against that version rather than letting
  // a last writer silently discard progress.
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await getAccountUserId()) !== userId) {
      return { ok: false, mergedFromRemote: false };
    }

    const push = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: merged, base_updated_at: baseUpdatedAt }),
    });
    if (push.ok) {
      try {
        window.localStorage.setItem(SYNC_LAST_KEY, String(Date.now()));
      } catch {}
      window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
      return { ok: true, mergedFromRemote };
    }
    if (push.status !== 409) return { ok: false, mergedFromRemote };

    let latest: { state: SyncState | null; updated_at: string | null };
    try {
      latest = (await push.json()) as {
        state: SyncState | null;
        updated_at: string | null;
      };
    } catch {
      return { ok: false, mergedFromRemote };
    }
    if (!latest.updated_at) return { ok: false, mergedFromRemote };
    merged = latest.state ? mergeStates(merged, latest.state) : merged;
    baseUpdatedAt = latest.updated_at;
    mergedFromRemote = mergedFromRemote || Boolean(latest.state);
    applyState(merged);
  }
  return { ok: false, mergedFromRemote };
}

/** Notify the sync manager that local study state changed. */
export function notifyStateChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(STATE_CHANGED_EVENT));
  } catch {
    /* SSR */
  }
}

/**
 * Reset study progress locally AND on the sync server (plain push, no merge —
 * otherwise the union-merge would resurrect the old state on the next sync).
 * @param subject a subject slug to reset only that subject, or undefined for everything
 */
export async function resetProgress(subject?: string): Promise<boolean> {
  // Capture the initiating account before joining any existing sync/reset work.
  // Otherwise a reset queued behind account A's operation could capture account
  // B after a sign-in switch and force-reset B's remote state instead.
  const resetUserId = await getAccountUserId();

  return queueStateOperation(async () => {
    if ((await getAccountUserId()) !== resetUserId) return false;
    try {
      const raw = window.localStorage.getItem(PROGRESS_KEY);
      if (raw) {
        if (!subject) {
          window.localStorage.removeItem(PROGRESS_KEY);
        } else {
          const p = JSON.parse(raw) as ProgressState;
          const strip = <T,>(obj: Record<string, T> | undefined): Record<string, T> =>
            Object.fromEntries(
              Object.entries(obj ?? {}).filter(([k]) => !k.startsWith(`${subject}/`))
            );
          const next: ProgressState = {
            q: strip(p.q),
            quiz: strip(p.quiz),
            practice: strip(p.practice),
          };
          window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
        }
      }
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (
          key?.startsWith(DECK_PREFIX) &&
          (!subject || key.startsWith(`${DECK_PREFIX}${subject}:`))
        ) {
          toRemove.push(key);
        }
      }
      toRemove.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      return false;
    }

    // Make every open view reload the (now reset) state.
    window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));

    // Overwrite the authenticated account copy (plain push, no merge), so reset
    // is reflected on every signed-in device instead of resurrecting old state.
    if (!resetUserId) return true;
    if ((await getAccountUserId()) !== resetUserId) return false;
    try {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: gatherState(), force: true }),
      });
      if (res.ok) {
        window.localStorage.setItem(SYNC_LAST_KEY, String(Date.now()));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  });
}
