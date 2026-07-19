import "server-only";

import { cache } from "react";
import { getProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { Bi } from "@/lib/types";

export type AccessReason = "admin" | "preview" | "entitled" | "locked";

export interface Access {
  canStudy: boolean;
  reason: AccessReason;
}

/** Entitlement-only subject access. Preview access is deliberately unit-specific. */
export const getSubjectAccess = cache(async (subjectId: string): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_subject_access", {
    p_subject_id: subjectId,
  });
  if (error) {
    console.error("has_subject_access failed", error.message);
    return false;
  }
  return data === true;
});

export const getCurrentPreviewUnitId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_current_preview_unit");
  if (error) {
    console.error("get_current_preview_unit failed", error.message);
    return null;
  }
  return typeof data === "string" ? data : null;
});

/** Per-request page gate. Errors and missing state fail closed. */
export async function getAccess(subjectId: string, unitId: string): Promise<Access> {
  const profile = await getProfile();
  if (profile?.role === "admin") return { canStudy: true, reason: "admin" };

  const [entitled, previewUnitId] = await Promise.all([
    getSubjectAccess(subjectId),
    getCurrentPreviewUnitId(),
  ]);
  if (entitled) return { canStudy: true, reason: "entitled" };
  if (previewUnitId === unitId) return { canStudy: true, reason: "preview" };
  return { canStudy: false, reason: "locked" };
}

/** True for admin or a covering entitlement; used once on subject-home card lists. */
export async function getSubjectPageAccess(subjectId: string): Promise<boolean> {
  const profile = await getProfile();
  return profile?.role === "admin" || getSubjectAccess(subjectId);
}

export const getActiveEntitlementExpiry = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entitlements")
    .select("expires_at")
    .is("revoked_at", null)
    .lte("starts_at", new Date().toISOString())
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.expires_at as string;
});

export interface CatalogSubject {
  id: string;
  slug: string;
  title: Bi;
  tagline: Bi;
}

/** Published subjects attached to the current user's track. Catalog is a lens, not the wall. */
export const getMyTrackSubjects = cache(async (): Promise<CatalogSubject[]> => {
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("track_id").maybeSingle();
  if (!profile?.track_id) return [];

  const { data, error } = await supabase
    .from("track_subjects")
    .select("subjects!inner(id,slug,title,tagline,status)")
    .eq("track_id", profile.track_id)
    .eq("subjects.status", "published")
    .order("sort", { ascending: true });
  if (error || !data) return [];

  return data
    .map((row) => (row as unknown as { subjects: CatalogSubject }).subjects)
    .filter(Boolean);
});
