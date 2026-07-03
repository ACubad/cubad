import { getSubjects, getUnits } from "@/lib/content";
import { SubjectPicker } from "@/components/SubjectPicker";

export default function HomePage() {
  const subjects = getSubjects();
  const unitsBySubject = Object.fromEntries(
    subjects.map((s) => [s.slug, getUnits(s.slug)])
  );
  return <SubjectPicker subjects={subjects} unitsBySubject={unitsBySubject} />;
}
