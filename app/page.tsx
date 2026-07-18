import { SubjectPicker } from "@/components/SubjectPicker";
import { getSubjects, getUnits } from "@/lib/content-db";
import type { Unit } from "@/lib/types";

export default async function HomePage() {
  const subjects = await getSubjects();
  const entries = await Promise.all(
    subjects.map(async (subject): Promise<[string, Unit[]]> => [subject.slug, await getUnits(subject.slug)])
  );
  return <SubjectPicker subjects={subjects} unitsBySubject={Object.fromEntries(entries)} />;
}
