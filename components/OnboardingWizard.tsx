"use client";

import { useActionState } from "react";
import { useLang } from "@/lib/i18n";
import type { Bi } from "@/lib/types";
import { COUNTRIES } from "@/lib/countries";
import { completeOnboarding, type OnboardState } from "@/app/onboarding/actions";
import { SubmitButton } from "@/components/auth/SubmitButton";

export interface TrackOption {
  id: string;
  title: Bi;
  country_code: string;
  system: string;
  level: string;
}

export function OnboardingWizard({ tracks }: { tracks: TrackOption[] }) {
  const { t, bi, lang } = useLang();
  const [state, action] = useActionState<OnboardState, FormData>(completeOnboarding, undefined);
  const err = (field: string) =>
    state?.errorKey === field ? (
      <p className="mt-1 text-xs text-clay">{t("authErr_unknown")}</p>
    ) : null;

  return (
    <form action={action} className="grid gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{t("onboardingTitle")}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t("onboardingIntro")}</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{t("fullName")}</span>
        <input name="full_name" required minLength={2}
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
        {err("fullName")}
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{t("country")}</span>
        <select name="country_code" required defaultValue=""
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          <option value="" disabled>{t("chooseCountry")}</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{bi(c.name)}</option>
          ))}
        </select>
        {err("country")}
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{t("phone")}</span>
        <input name="phone" type="tel" autoComplete="tel"
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{t("preferredLanguage")}</span>
        <select name="preferred_lang" defaultValue={lang}
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          <option value="tr">Türkçe</option>
          <option value="en">English</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{t("track")}</span>
        <select name="track_id" required defaultValue=""
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          <option value="" disabled>{t("chooseTrack")}</option>
          {tracks.map((tr) => (
            <option key={tr.id} value={tr.id}>{bi(tr.title)}</option>
          ))}
        </select>
        {err("track")}
      </label>

      <SubmitButton label={t("finishOnboarding")} />
    </form>
  );
}
