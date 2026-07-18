"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useLang, type StringKey } from "@/lib/i18n";
import { signUp, type AuthState } from "@/app/auth/actions";
import { AuthField } from "./AuthField";
import { SubmitButton } from "./SubmitButton";

export function SignUpForm() {
  const { t } = useLang();
  const [state, action] = useActionState<AuthState, FormData>(signUp, undefined);

  if (state?.done) {
    return (
      <div>
        <h1 className="mb-2 font-display text-xl font-semibold text-ink">{t("checkEmailTitle")}</h1>
        <p className="text-sm text-ink-soft">{t("checkEmailBody")}</p>
        <Link href="/auth/sign-in" className="mt-4 inline-block text-sm font-semibold text-deniz hover:text-deniz-deep">
          {t("signIn")}
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-3">
      <h1 className="font-display text-xl font-semibold text-ink">{t("signUpTitle")}</h1>
      <AuthField id="email" label={t("email")} type="email" autoComplete="email" />
      <AuthField id="password" label={t("password")} type="password" autoComplete="new-password" />
      <AuthField id="confirm" label={t("confirmPassword")} type="password" autoComplete="new-password" />
      {state?.errorCode && (
        <p className="text-xs text-clay">{t(`authErr_${state.errorCode}` as StringKey)}</p>
      )}
      <SubmitButton label={t("signUp")} />
      <p className="text-xs text-ink-soft">
        {t("haveAccount")}{" "}
        <Link href="/auth/sign-in" className="font-semibold text-deniz hover:text-deniz-deep">
          {t("signIn")}
        </Link>
      </p>
    </form>
  );
}
