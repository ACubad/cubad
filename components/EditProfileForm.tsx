"use client";

import { useActionState } from "react";
import { useLang } from "@/lib/i18n";
import { COUNTRIES } from "@/lib/countries";
import { completeOnboarding, type OnboardState } from "@/app/onboarding/actions";
import { SubmitButton } from "@/components/auth/SubmitButton";
import type { TrackOption } from "@/components/OnboardingWizard";
import type { Profile } from "@/lib/auth/dal";

export function EditProfileForm({ profile, tracks }: { profile: Profile; tracks: TrackOption[] }) {
  const { t, bi } = useLang();
  const [, action] = useActionState<OnboardState, FormData>(completeOnboarding, undefined);
  return (
    <form action={action} className="grid gap-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{t("fullName")}</span>
        <input name="full_name" required minLength={2} defaultValue={profile.full_name}
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{t("country")}</span>
        <select name="country_code" defaultValue={profile.country_code}
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          {COUNTRIES.map((c) => (<option key={c.code} value={c.code}>{bi(c.name)}</option>))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{t("phone")}</span>
        <input name="phone" type="tel" defaultValue={profile.phone}
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{t("preferredLanguage")}</span>
        <select name="preferred_lang" defaultValue={profile.preferred_lang}
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          <option value="tr">Türkçe</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{t("track")}</span>
        <select name="track_id" defaultValue={profile.track_id ?? ""}
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          {tracks.map((tr) => (<option key={tr.id} value={tr.id}>{bi(tr.title)}</option>))}
        </select>
      </label>
      <SubmitButton label={t("saveChanges")} />
    </form>
  );
}
