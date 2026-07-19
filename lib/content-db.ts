// DB-backed runtime replacement for lib/content.ts. Content reads use the previous Next 16
// cache model because this app does not enable Cache Components: unstable_cache plus tags.
// The service-role client deliberately bypasses RLS; Phase 4 adds user-aware gating in pages.
import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
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

export interface UnitMeta {
  id: string;
  subjectId: string;
  unit: number;
  slug: string;
  isFree: boolean;
  title: Unit["title"];
  tagline: Unit["tagline"];
  questionIds: string[];
  practiceIds: string[];
  notesCount: number;
  flashcardsCount: number;
}

export interface SubjectCatalog {
  subject: SubjectMeta & { id: string };
  units: UnitMeta[];
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

/** Catalog metadata loader. The draft-inclusive branch is called only after an admin check. */
async function getSubjectCatalogByVisibility(
  slug: string,
  includeUnpublished: boolean
): Promise<SubjectCatalog | null> {
  const run = unstable_cache(
    async (): Promise<SubjectCatalog | null> => {
      const supabase = createServiceRoleClient();
      let subjectQuery = supabase
        .from("subjects")
        .select("id,slug,title,tagline,section_order")
        .eq("slug", slug);
      if (!includeUnpublished) subjectQuery = subjectQuery.eq("status", "published");
      const { data: subjectRow, error: subjectError } = await subjectQuery.maybeSingle();
      if (subjectError) throw new Error(`getSubjectCatalog(${slug}): ${subjectError.message}`);
      if (!subjectRow) return null;

      let unitsQuery = supabase
        .from("units")
        .select("id,subject_id,unit_number,slug,is_free,content")
        .eq("subject_id", subjectRow.id);
      if (!includeUnpublished) unitsQuery = unitsQuery.eq("status", "published");
      const { data, error } = await unitsQuery.order("unit_number", { ascending: true });
      if (error) throw new Error(`getSubjectCatalog(${slug}): ${error.message}`);

      const subject = {
        id: subjectRow.id as string,
        ...toSubjectMeta(subjectRow as SubjectRow),
      };
      const units = (data ?? []).map((row) => {
        const content = row.content as unknown as Unit;
        return {
          id: row.id as string,
          subjectId: row.subject_id as string,
          unit: row.unit_number as number,
          slug: row.slug as string,
          isFree: row.is_free as boolean,
          title: content.title,
          tagline: content.tagline,
          questionIds: (content.questions ?? []).map((question) => question.id),
          practiceIds: (content.practice ?? []).map((practice) => practice.id),
          notesCount: content.notes?.length ?? 0,
          flashcardsCount: content.flashcards?.length ?? 0,
        } satisfies UnitMeta;
      });
      return { subject, units };
    },
    ["content-db:subject-catalog:v2", slug, includeUnpublished ? "all" : "published"],
    { tags: [subjectTag(slug), LIST_TAG], revalidate: false }
  );
  return run();
}

/** Public-safe published catalog metadata. Full unit JSON is never serialized to the client. */
export async function getSubjectCatalog(slug: string): Promise<SubjectCatalog | null> {
  return getSubjectCatalogByVisibility(slug, false);
}

/** Draft-inclusive metadata for a route that has already established the caller is an admin. */
export async function getAdminSubjectCatalog(slug: string): Promise<SubjectCatalog | null> {
  return getSubjectCatalogByVisibility(slug, true);
}

export async function getUnitMeta(subject: string, slug: string): Promise<UnitMeta | null> {
  const catalog = await getSubjectCatalog(subject);
  return catalog?.units.find((unit) => unit.slug === slug) ?? null;
}

/** User-scoped content read through the database gate. Never cache this across requests. */
export async function getUnitContent(subject: string, slug: string): Promise<Unit | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_unit_content", {
    p_subject_slug: subject,
    p_unit_slug: slug,
  });
  if (error) {
    console.error("get_unit_content failed", error.message);
    return null;
  }
  return data ? (data as Unit) : null;
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
