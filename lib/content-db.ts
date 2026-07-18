// DB-backed runtime replacement for lib/content.ts. Content reads use the previous Next 16
// cache model because this app does not enable Cache Components: unstable_cache plus tags.
// The service-role client deliberately bypasses RLS; Phase 4 adds user-aware gating in pages.
import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Question, SubjectMeta, Unit } from "./types";

const LIST_TAG = "content:list";
const subjectTag = (slug: string) => `content:${slug}`;

interface SubjectRow {
  slug: string;
  title: { tr: string; en: string };
  tagline: { tr: string; en: string };
  section_order: "walkthrough" | "study";
}

interface UnitRow {
  content: Unit;
}

export function toSubjectMeta(row: SubjectRow): SubjectMeta {
  return {
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    section_order: row.section_order,
    kind: row.section_order,
  };
}

/** `units.content` is the full Unit shape; preserve it without a lossy mapping. */
export function toUnit(row: UnitRow): Unit {
  return row.content;
}

const fetchSubjects = unstable_cache(
  async (): Promise<SubjectMeta[]> => {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("subjects")
      .select("slug, title, tagline, section_order")
      .eq("status", "published")
      .order("sort", { ascending: true });
    if (error) throw new Error(`getSubjects: ${error.message}`);
    return (data ?? []).map(toSubjectMeta);
  },
  ["content-db:subjects:v1"],
  { tags: [LIST_TAG], revalidate: false }
);

export async function getSubjects(): Promise<SubjectMeta[]> {
  return fetchSubjects();
}

export async function getSubject(slug: string): Promise<SubjectMeta | undefined> {
  const subjects = await getSubjects();
  return subjects.find((subject) => subject.slug === slug);
}

/**
 * The wrapper is intentionally created inside this function. Next caches by key parts and
 * arguments, so each subject gets its own persisted cache entry and tags.
 */
export async function getUnits(subject: string): Promise<Unit[]> {
  const run = unstable_cache(
    async (): Promise<Unit[]> => {
      const supabase = createServiceRoleClient();
      const { data: subjectRow, error: subjectError } = await supabase
        .from("subjects")
        .select("id")
        .eq("slug", subject)
        .eq("status", "published")
        .maybeSingle();
      if (subjectError) throw new Error(`getUnits(${subject}): ${subjectError.message}`);
      if (!subjectRow) return [];

      const { data, error } = await supabase
        .from("units")
        .select("content")
        .eq("subject_id", subjectRow.id)
        .eq("status", "published")
        .order("unit_number", { ascending: true });
      if (error) throw new Error(`getUnits(${subject}): ${error.message}`);
      return (data ?? []).map(toUnit);
    },
    ["content-db:units:v1", subject],
    { tags: [subjectTag(subject), LIST_TAG], revalidate: false }
  );
  return run();
}

export async function getUnit(subject: string, slug: string): Promise<Unit | undefined> {
  const units = await getUnits(subject);
  return units.find((unit) => unit.slug === slug);
}

export async function getQuestion(
  subject: string,
  id: string
): Promise<{ unit: Unit; question: Question; index: number } | undefined> {
  for (const unit of await getUnits(subject)) {
    const index = (unit.questions ?? []).findIndex((question) => question.id === id);
    if (index >= 0) return { unit, question: unit.questions![index], index };
  }
  return undefined;
}

/** Flat ordered question ids, used for previous/next walkthrough navigation. */
export async function getQuestionOrder(
  subject: string
): Promise<{ id: string; unitSlug: string }[]> {
  const units = await getUnits(subject);
  return units.flatMap((unit) =>
    (unit.questions ?? []).map((question) => ({ id: question.id, unitSlug: unit.slug }))
  );
}

/** Call after content mutations. `max` is the required Next 16 SWR profile. */
export function revalidateContent(subjectSlug?: string): void {
  revalidateTag(subjectSlug ? subjectTag(subjectSlug) : LIST_TAG, "max");
}
