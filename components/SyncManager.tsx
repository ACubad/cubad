"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { STATE_CHANGED_EVENT, syncEnabled, syncNow } from "@/lib/sync";

/**
 * Invisible component mounted once in the root layout. Pull-merge-pushes on
 * page load and (debounced) after every local study-state change — for either
 * an account session or a passcode.
 */
export function SyncManager() {
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let started: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      if ((await syncEnabled()) && !cancelled) {
        started = setTimeout(() => void syncNow(), 800);
      }
    })();
    return () => {
      cancelled = true;
      if (started) clearTimeout(started);
    };
  }, [pathname]);

  useEffect(() => {
    const onChange = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        if (busy.current) return;
        if (!(await syncEnabled())) return;
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
