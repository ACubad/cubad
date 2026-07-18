"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { legacyRowId } from "@/lib/passcode";
import { mergeStates, type SyncState } from "@/lib/merge";
import { COUNTRY_CODES } from "@/lib/countries";

export type OnboardState = { errorKey?: string } | undefined;

const EMPTY: SyncState = { progress: { q: {}, quiz: {}, practice: {} }, decks: {} };

export async function completeOnboarding(_prev: OnboardState, formData: FormData): Promise<OnboardState> {
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
  if (preferred_lang !== "tr" && preferred_lang !== "en") return { errorKey: "preferredLanguage" };

  // track_id must be a real, published track (single-track per D6).
  // WHY service-role: tracks gets a public read policy in Phase 3/4; until then
  // the anon/cookie client sees 0 rows, so service-role read is required.
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

export type ImportResult =
  | { ok: true }
  | { ok: false; errorKey: "importPasscodeNotFound" | "authErr_unknown" | "importPasscodeBad" };

export async function importPasscode(_prev: ImportResult | undefined, formData: FormData): Promise<ImportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, errorKey: "authErr_unknown" };

  const code = String(formData.get("passcode") ?? "").trim();
  if (code.length < 4 || code.length > 128) return { ok: false, errorKey: "importPasscodeBad" };

  const id = legacyRowId(code);
  const service = createServiceRoleClient(); // legacy_sync has no client RLS access

  const { data: legacy, error: readErr } = await service
    .from("legacy_sync")
    .select("state, claimed_by")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return { ok: false, errorKey: "authErr_unknown" };
  if (!legacy || !legacy.state) return { ok: false, errorKey: "importPasscodeNotFound" };

  // Merge into whatever the account already has (owner RLS on user_state).
  const { data: cur } = await supabase
    .from("user_state")
    .select("state")
    .eq("user_id", user.id)
    .maybeSingle();
  const local = (cur?.state as SyncState) ?? EMPTY;
  const merged = mergeStates(local, legacy.state as SyncState);

  const { error: upErr } = await supabase
    .from("user_state")
    .upsert(
      { user_id: user.id, state: merged, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (upErr) return { ok: false, errorKey: "authErr_unknown" };

  // Mark claimed (informational only). Re-import is allowed and idempotent-safe:
  // the union-merge never loses data, so claiming a second time — even a row
  // already claimed by another account — just re-merges. claimed_by is not a lock.
  await service.from("legacy_sync").update({ claimed_by: user.id }).eq("id", id);

  revalidatePath("/account");
  return { ok: true };
}
