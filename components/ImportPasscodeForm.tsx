"use client";

import { useActionState } from "react";
import { useLang } from "@/lib/i18n";
import { importPasscode, type ImportResult } from "@/app/onboarding/actions";

export function ImportPasscodeForm() {
  const { t } = useLang();
  const [state, action] = useActionState<ImportResult | undefined, FormData>(importPasscode, undefined);
  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <h2 className="mb-1 font-display text-lg font-semibold text-ink">🔑 {t("importPasscodeTitle")}</h2>
      <p className="mb-3 text-sm text-ink-soft">{t("importPasscodeIntro")}</p>
      <form action={action} className="flex flex-wrap gap-2">
        <input
          type="text"
          name="passcode"
          placeholder={t("importPasscodeTitle")}
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm sm:max-w-xs"
        />
        <button
          type="submit"
          className="rounded-full bg-deniz px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
        >
          {t("importPasscodeBtn")}
        </button>
      </form>
      {state?.ok && <p className="mt-2 text-xs text-moss">✓ {t("importPasscodeDone")}</p>}
      {state && !state.ok && state.errorKey === "importPasscodeNotFound" && (
        <p className="mt-2 text-xs text-clay">{t("importPasscodeNotFound")}</p>
      )}
      {state && !state.ok && state.errorKey !== "importPasscodeNotFound" && (
        <p className="mt-2 text-xs text-clay">{t("authErr_unknown")}</p>
      )}
    </div>
  );
}
