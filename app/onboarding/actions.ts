"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { COUNTRY_CODES } from "@/lib/countries";

export type OnboardState = { errorKey?: string } | undefined;

export async function completeOnboarding(
  _prev: OnboardState,
  formData: FormData
): Promise<OnboardState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const full_name = String(formData.get("full_name") ?? "").trim();
  const country_code = String(formData.get("country_code") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const preferred_lang = String(formData.get("preferred_lang") ?? "tr");
  const track_id = String(formData.get("track_id") ?? "").trim();

  if (full_name.length < 2) return { errorKey: "fullName" };
  if (!COUNTRY_CODES.includes(country_code)) return { errorKey: "country" };
  if (preferred_lang !== "tr" && preferred_lang !== "en") {
    return { errorKey: "preferredLanguage" };
  }

  // tracks do not yet have a client read policy. Only the selected id is read.
  const service = createServiceRoleClient();
  const { data: track } = await service
    .from("tracks")
    .select("id")
    .eq("id", track_id)
    .eq("status", "published")
    .maybeSingle();
  if (!track) return { errorKey: "track" };

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name,
      country_code,
      phone,
      preferred_lang,
      track_id,
      onboarded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) return { errorKey: "unknown" };

  revalidatePath("/", "layout");
  redirect("/account");
}
