import fs from "node:fs";
import path from "node:path";
import type { Question, Unit } from "./types";

const CONTENT_DIR = path.join(process.cwd(), "content");

let cache: Unit[] | null = null;

export function getUnits(): Unit[] {
  if (cache) return cache;
  if (!fs.existsSync(CONTENT_DIR)) return [];
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => /^unit-\d+\.json$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]));
  cache = files.map(
    (f) => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, f), "utf-8")) as Unit
  );
  return cache;
}

export function getUnit(slug: string): Unit | undefined {
  return getUnits().find((u) => u.slug === slug);
}

export function getQuestion(
  id: string
): { unit: Unit; question: Question; index: number } | undefined {
  for (const unit of getUnits()) {
    const index = unit.questions.findIndex((q) => q.id === id);
    if (index >= 0) return { unit, question: unit.questions[index], index };
  }
  return undefined;
}

/** Flat ordered list of all question ids, for prev/next navigation. */
export function getQuestionOrder(): { id: string; unitSlug: string }[] {
  return getUnits().flatMap((u) =>
    u.questions.map((q) => ({ id: q.id, unitSlug: u.slug }))
  );
}
