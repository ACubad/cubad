"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { STATE_CHANGED_EVENT, syncNow } from "@/lib/sync";

const RETIRED_PASSCODE_KEY = "cubad:sync:code";

/**
 * Invisible component mounted once in the root layout. A signed-in account is
 * the only cross-device source of truth: it merges state on sign-in, page
 * loads, and debounced local study-state changes.
 */
export function SyncManager() {
  const pathname = usePathname();
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  const runSync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await syncNow();
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const started = setTimeout(() => void runSync(), 800);
    return () => clearTimeout(started);
  }, [pathname, runSync]);

  useEffect(() => {
    // Remove an obsolete locally stored passcode after the authenticated
    // replacement has shipped. It is no longer read, sent, or persisted.
    try {
      window.localStorage.removeItem(RETIRED_PASSCODE_KEY);
    } catch {
      /* storage blocked */
    }

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        // Let the new session cookie settle before requesting /api/state.
        window.setTimeout(() => void runSync(), 150);
      }
    });
    return () => subscription.unsubscribe();
  }, [runSync]);

  useEffect(() => {
    const onChange = () => {
      if (changeTimer.current) clearTimeout(changeTimer.current);
      changeTimer.current = setTimeout(() => void runSync(), 3000);
    };
    window.addEventListener(STATE_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(STATE_CHANGED_EVENT, onChange);
      if (changeTimer.current) clearTimeout(changeTimer.current);
    };
  }, [runSync]);

  return null;
}
