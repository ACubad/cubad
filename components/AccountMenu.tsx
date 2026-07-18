"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/i18n";
import type { Bi } from "@/lib/types";
import { createClient } from "@/lib/supabase/browser";
import { signOut } from "@/app/auth/actions";

interface AccountInfo { email: string; fullName: string; trackTitle: Bi | null; }
interface AccountState { info: AccountInfo | null; path: string | null; }

export function AccountMenu() {
  const { t, bi } = useLang();
  const pathname = usePathname();
  const [account, setAccount] = useState<AccountState>({ info: null, path: null });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const load = async () => {
      try {
        // /api/me resolves profile + track title server-side (a browser-side
        // tracks read would return 0 rows until Phase 3/4 adds its policy).
        const res = await fetch("/api/me");
        const body = (await res.json()) as { me: AccountInfo | null };
        if (active) setAccount({ info: body.me, path: pathname });
      } catch {
        if (active) setAccount({ info: null, path: pathname });
      }
    };
    void load();
    // re-fetch whenever the auth state changes (sign-in/out in this tab)
    const { data: sub } = supabase.auth.onAuthStateChange(() => void load());
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [pathname]);

  if (account.path !== pathname) return null; // avoid stale auth UI during a route transition
  const { info } = account;
  if (!info) {
    return (
      <Link
        href="/auth/sign-in"
        className="ml-2 rounded-full bg-deniz px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-deniz-deep"
      >
        {t("signIn")}
      </Link>
    );
  }
  const initial = (info.fullName || info.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="relative ml-2">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-deniz text-sm font-semibold text-white"
      >
        {initial}
      </button>
      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 w-48 rounded-xl border border-line bg-card p-2 shadow-lg"
          >
            {info.trackTitle && (
              <p className="px-2 py-1 text-[11px] text-ink-faint">{bi(info.trackTitle)}</p>
            )}
            <Link
              href="/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-2 py-1.5 text-sm text-ink-soft hover:bg-wash hover:text-deniz-deep"
            >
              {t("account")}
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                role="menuitem"
                className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-clay hover:bg-clay-soft"
              >
                {t("signOut")}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
