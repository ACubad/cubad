import { notFound } from "next/navigation";
import { getSubject, getSubjects, getUnit, getUnits } from "@/lib/content";
import { UnitView } from "@/components/UnitView";
import { StudyUnitView } from "@/components/StudyUnitView";

export function generateStaticParams() {
  return getSubjects().flatMap((s) =>
    getUnits(s.slug).map((u) => ({ subject: s.slug, slug: u.slug }))
  );
}

export default async function UnitPage({
  params,
}: {
  params: Promise<{ subject: string; slug: string }>;
}) {
  const { subject: subjectSlug, slug } = await params;
  const subject = getSubject(subjectSlug);
  const unit = getUnit(subjectSlug, slug);
  if (!subject || !unit) notFound();

  if (subject.kind === "walkthrough") {
    return <UnitView subject={subjectSlug} unit={unit} />;
  }
  return <StudyUnitView subject={subjectSlug} unit={unit} />;
}
