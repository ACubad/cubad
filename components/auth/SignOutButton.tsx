"use client";

import { useLang } from "@/lib/i18n";
import { signOut } from "@/app/auth/actions";

export function SignOutButton() {
  const { t } = useLang();
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded-full border border-clay/40 px-4 py-2 text-sm font-semibold text-clay transition-colors hover:bg-clay-soft"
      >
        {t("signOut")}
      </button>
    </form>
  );
}
