"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useLang, type StringKey } from "@/lib/i18n";
import { signIn, type AuthState } from "@/app/auth/actions";
import { AuthField } from "./AuthField";
import { SubmitButton } from "./SubmitButton";

export function SignInForm({ next }: { next?: string }) {
  const { t } = useLang();
  const [state, action] = useActionState<AuthState, FormData>(signIn, undefined);
  return (
    <form action={action} className="grid gap-3">
      <h1 className="font-display text-xl font-semibold text-ink">{t("signInTitle")}</h1>
      {next && <input type="hidden" name="next" value={next} />}
      <AuthField id="email" label={t("email")} type="email" autoComplete="email" />
      <AuthField id="password" label={t("password")} type="password" autoComplete="current-password" />
      {state?.errorCode && (
        <p className="text-xs text-clay">{t(`authErr_${state.errorCode}` as StringKey)}</p>
      )}
      <SubmitButton label={t("signIn")} />
      <div className="flex items-center justify-between text-xs text-ink-soft">
        <Link href="/auth/forgot-password" className="font-semibold text-deniz hover:text-deniz-deep">
          {t("forgotPassword")}
        </Link>
        <Link href="/auth/sign-up" className="font-semibold text-deniz hover:text-deniz-deep">
          {t("signUp")}
        </Link>
      </div>
    </form>
  );
}
