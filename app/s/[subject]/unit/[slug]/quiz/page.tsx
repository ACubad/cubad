import { QuizRunner } from "@/components/QuizRunner";
import { getSubject, getUnit } from "@/lib/content-db";
import { notFound } from "next/navigation";

export default async function QuizPage({ params }: { params: Promise<{ subject: string; slug: string }> }) {
  const { subject: subjectSlug, slug } = await params;
  const subject = await getSubject(subjectSlug);
  const unit = subject ? await getUnit(subjectSlug, slug) : undefined;
  if (!subject || !unit || (unit.quiz?.length ?? 0) === 0) notFound();
  return <QuizRunner subject={subjectSlug} unit={unit} />;
}
