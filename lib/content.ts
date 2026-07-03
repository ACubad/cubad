import fs from "node:fs";
import path from "node:path";
import type { Question, SubjectMeta, Unit } from "./types";

const CONTENT_DIR = path.join(process.cwd(), "content");
const SUBJECTS_FILE = path.join(CONTENT_DIR, "subjects.json");

let subjectsCache: SubjectMeta[] | null = null;
const unitsCache = new Map<string, Unit[]>();

export function getSubjects(): SubjectMeta[] {
  if (subjectsCache) return subjectsCache;
  if (!fs.existsSync(SUBJECTS_FILE)) return [];
  subjectsCache = JSON.parse(fs.readFileSync(SUBJECTS_FILE, "utf-8")) as SubjectMeta[];
  return subjectsCache;
}

export function getSubject(slug: string): SubjectMeta | undefined {
  return getSubjects().find((s) => s.slug === slug);
}

export function getUnits(subject: string): Unit[] {
  const cached = unitsCache.get(subject);
  if (cached) return cached;
  const dir = path.join(CONTENT_DIR, subject);
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^unit-\d+\.json$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]));
  const units = files.map(
    (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as Unit
  );
  unitsCache.set(subject, units);
  return units;
}

export function getUnit(subject: string, slug: string): Unit | undefined {
  return getUnits(subject).find((u) => u.slug === slug);
}

export function getQuestion(
  subject: string,
  id: string
): { unit: Unit; question: Question; index: number } | undefined {
  for (const unit of getUnits(subject)) {
    const index = (unit.questions ?? []).findIndex((q) => q.id === id);
    if (index >= 0) return { unit, question: unit.questions![index], index };
  }
  return undefined;
}

/** Flat ordered list of all question ids, for prev/next navigation. */
export function getQuestionOrder(subject: string): { id: string; unitSlug: string }[] {
  return getUnits(subject).flatMap((u) =>
    (u.questions ?? []).map((q) => ({ id: q.id, unitSlug: u.slug }))
  );
}
