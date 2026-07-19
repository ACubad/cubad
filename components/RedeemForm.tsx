"use client";

import Link from "next/link";
import { useActionState } from "react";
import { redeemAction, type RedeemState } from "@/app/redeem/actions";
import { useLang, type StringKey } from "@/lib/i18n";

const ERROR_KEY: Record<string, StringKey> = {
  "invalid-code": "redeemErrInvalidCode",
  expired: "redeemErrExpired",
  exhausted: "redeemErrExhausted",
  "already-redeemed": "redeemErrAlreadyRedeemed",
  "rate-limited": "redeemErrRateLimited",
  generic: "redeemErrGeneric",
};

const initial: RedeemState = { status: "idle" };

export function RedeemForm({ next }: { next: string }) {
  const { t } = useLang();
  const [state, action, pending] = useActionState(redeemAction, initial);

  if (state.status === "success") {
    return (
      <div className="rise-in rounded-2xl border border-moss/30 bg-moss-soft p-6 text-center">
        <p className="text-2xl" aria-hidden>✓</p>
        <h1 className="mt-1 font-display text-xl font-semibold text-moss">
          {t("redeemSuccessTitle")}
        </h1>
        <p className="mt-1 text-ink-soft">{t("redeemSuccessBody")}</p>
        <Link
          href={state.next}
          className="mt-5 inline-flex rounded-xl bg-deniz px-4 py-2.5 font-semibold text-white hover:bg-deniz-deep"
        >
          {t("continueStudying")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-2xl border border-line bg-card p-6">
      <input type="hidden" name="next" value={next} />
      <h1 className="font-display text-2xl font-semibold text-deniz-deep">{t("redeemTitle")}</h1>
      <p className="mt-2 text-ink-soft">{t("redeemIntro")}</p>
      <input
        name="code"
        required
        maxLength={128}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder={t("redeemPlaceholder")}
        className="mt-4 w-full rounded-xl border border-line bg-paper px-4 py-3 text-center font-mono text-lg tracking-widest text-ink outline-none focus:border-deniz/60"
      />
      {state.status === "error" && (
        <p className="mt-3 text-sm font-medium text-clay" role="alert">
          {t(ERROR_KEY[state.error] ?? "redeemErrGeneric")}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-xl bg-deniz px-4 py-3 font-semibold text-white transition-colors hover:bg-deniz-deep disabled:opacity-60"
      >
        {pending ? t("redeemPending") : t("redeemSubmit")}
      </button>
    </form>
  );
}
