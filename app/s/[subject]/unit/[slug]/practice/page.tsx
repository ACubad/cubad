import { PracticeRunner } from "@/components/PracticeRunner";
import { getSubject, getUnit } from "@/lib/content-db";
import { notFound } from "next/navigation";

export default async function PracticePage({ params }: { params: Promise<{ subject: string; slug: string }> }) {
  const { subject: subjectSlug, slug } = await params;
  const subject = await getSubject(subjectSlug);
  const unit = subject ? await getUnit(subjectSlug, slug) : undefined;
  if (!subject || !unit || (unit.practice?.length ?? 0) === 0) notFound();
  return <PracticeRunner subject={subjectSlug} unit={unit} />;
}
