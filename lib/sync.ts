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
export const STATE_CHANGED_EVENT = "cubad:state-changed";
export const SYNC_APPLIED_EVENT = "cubad:sync-applied";

const PROGRESS_KEY = "cubad:progress:v2";
const DECK_PREFIX = "cubad:cards:";
const CHAT_PREFIX = "cubad:chats:";

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
  if (!(await getAccountUserId())) return { ok: false, mergedFromRemote: false };
  return syncNowAccount();
}

async function syncNowAccount(): Promise<{ ok: boolean; mergedFromRemote: boolean }> {
  const pull = await fetch("/api/state", { method: "GET" });
  if (!pull.ok) return { ok: false, mergedFromRemote: false };
  const remote = (await pull.json()) as { state: SyncState | null };

  const local = gatherState();
  const merged = remote.state ? mergeStates(local, remote.state) : local;
  applyState(merged);

  const push = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: merged }),
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

/**
 * Reset study progress locally AND on the sync server (plain push, no merge —
 * otherwise the union-merge would resurrect the old state on the next sync).
 * @param subject a subject slug to reset only that subject, or undefined for everything
 */
export async function resetProgress(subject?: string): Promise<boolean> {
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
      const k = window.localStorage.key(i);
      if (
        k?.startsWith(DECK_PREFIX) &&
        (!subject || k.startsWith(`${DECK_PREFIX}${subject}:`))
      ) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    return false;
  }

  // make every open view reload the (now reset) state
  window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));

  // Overwrite the authenticated account copy (plain push, no merge), so reset
  // is reflected on every signed-in device instead of resurrecting old state.
  if (!(await getAccountUserId())) return true;
  try {
    const res = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: gatherState() }),
    });
    if (res.ok) {
      window.localStorage.setItem(SYNC_LAST_KEY, String(Date.now()));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
