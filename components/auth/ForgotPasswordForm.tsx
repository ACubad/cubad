"use client";

import { useActionState } from "react";
import { useLang, type StringKey } from "@/lib/i18n";
import { requestPasswordReset, type AuthState } from "@/app/auth/actions";
import { AuthField } from "./AuthField";
import { SubmitButton } from "./SubmitButton";

export function ForgotPasswordForm() {
  const { t } = useLang();
  const [state, action] = useActionState<AuthState, FormData>(requestPasswordReset, undefined);
  if (state?.done) {
    return (
      <div>
        <h1 className="mb-2 font-display text-xl font-semibold text-ink">{t("checkEmailTitle")}</h1>
        <p className="text-sm text-ink-soft">{t("resetSentBody")}</p>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-3">
      <h1 className="font-display text-xl font-semibold text-ink">{t("forgotPasswordTitle")}</h1>
      <p className="text-sm text-ink-soft">{t("forgotPasswordIntro")}</p>
      <AuthField id="email" label={t("email")} type="email" autoComplete="email" />
      {state?.errorCode && (
        <p className="text-xs text-clay">{t(`authErr_${state.errorCode}` as StringKey)}</p>
      )}
      <SubmitButton label={t("sendResetLink")} />
    </form>
  );
}
