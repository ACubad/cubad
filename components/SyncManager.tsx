"use client";

import { useEffect, useRef } from "react";
import { getSyncCode, STATE_CHANGED_EVENT, syncNow } from "@/lib/sync";

/**
 * Invisible component mounted once in the root layout. Pull-merge-pushes on
 * page load and (debounced) after every local study-state change.
 */
export function SyncManager() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (getSyncCode()) {
      // initial sync shortly after load so the page renders first
      const t = setTimeout(() => void syncNow(), 800);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      if (!getSyncCode()) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        if (busy.current) return;
        busy.current = true;
        try {
          await syncNow();
        } finally {
          busy.current = false;
        }
      }, 3000);
    };
    window.addEventListener(STATE_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(STATE_CHANGED_EVENT, onChange);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return null;
}
