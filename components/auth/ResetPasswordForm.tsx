"use client";

import { useActionState } from "react";
import { useLang, type StringKey } from "@/lib/i18n";
import { updatePassword, type AuthState } from "@/app/auth/actions";
import { AuthField } from "./AuthField";
import { SubmitButton } from "./SubmitButton";

export function ResetPasswordForm() {
  const { t } = useLang();
  const [state, action] = useActionState<AuthState, FormData>(updatePassword, undefined);
  return (
    <form action={action} className="grid gap-3">
      <h1 className="font-display text-xl font-semibold text-ink">{t("resetPasswordTitle")}</h1>
      <AuthField id="password" label={t("newPassword")} type="password" autoComplete="new-password" />
      <AuthField id="confirm" label={t("confirmPassword")} type="password" autoComplete="new-password" />
      {state?.errorCode && (
        <p className="text-xs text-clay">{t(`authErr_${state.errorCode}` as StringKey)}</p>
      )}
      <SubmitButton label={t("updatePassword")} />
    </form>
  );
}
