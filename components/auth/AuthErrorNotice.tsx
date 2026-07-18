"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";

export function AuthErrorNotice() {
  const { t } = useLang();
  return (
    <div>
      <h1 className="mb-2 font-display text-xl font-semibold text-ink">{t("checkEmailTitle")}</h1>
      <p className="text-sm text-ink-soft">{t("authErr_expired_or_invalid")}</p>
      <div className="mt-4 flex gap-3 text-sm font-semibold">
        <Link href="/auth/sign-in" className="text-deniz hover:text-deniz-deep">{t("signIn")}</Link>
        <Link href="/auth/forgot-password" className="text-deniz hover:text-deniz-deep">{t("forgotPassword")}</Link>
      </div>
    </div>
  );
}
