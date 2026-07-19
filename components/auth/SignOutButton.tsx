"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/browser";
import { clearSignedOutStudyState } from "@/lib/sync";

export function SignOutButton({ className }: { className?: string }) {
  const { t } = useLang();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // The browser client owns the persisted Supabase session. Signing out
      // here triggers the local auth event as well as clearing its cookies.
      const { error } = await createClient().auth.signOut();
      if (error) {
        setBusy(false);
        return;
      }
      // Clear immediately too, so an old account's projection cannot remain
      // visible even if a browser suppresses an auth-state event.
      await clearSignedOutStudyState();
      router.replace("/auth/sign-in");
      router.refresh();
    } catch {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className={
        className ??
        "rounded-full border border-clay/40 px-4 py-2 text-sm font-semibold text-clay transition-colors hover:bg-clay-soft disabled:cursor-wait disabled:opacity-60"
      }
    >
      {t("signOut")}
    </button>
  );
}
