import { notFound } from "next/navigation";
import { getSubject, getSubjects, getUnit, getUnits } from "@/lib/content";
import { QuizRunner } from "@/components/QuizRunner";

export function generateStaticParams() {
  return getSubjects()
    .filter((s) => s.kind === "walkthrough")
    .flatMap((s) => getUnits(s.slug).map((u) => ({ subject: s.slug, slug: u.slug })));
}

export default async function QuizPage({
  params,
}: {
  params: Promise<{ subject: string; slug: string }>;
}) {
  const { subject: subjectSlug, slug } = await params;
  const subject = getSubject(subjectSlug);
  const unit = getUnit(subjectSlug, slug);
  if (!subject || !unit || subject.kind !== "walkthrough") notFound();
  return <QuizRunner subject={subjectSlug} unit={unit} />;
}
