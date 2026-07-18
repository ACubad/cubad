import { UnitPage } from "@/components/UnitPage";
import { getSubject, getUnit } from "@/lib/content-db";
import { notFound } from "next/navigation";

export default async function UnitRoutePage({ params }: { params: Promise<{ subject: string; slug: string }> }) {
  const { subject: subjectSlug, slug } = await params;
  const subject = await getSubject(subjectSlug);
  const unit = subject ? await getUnit(subjectSlug, slug) : undefined;
  if (!subject || !unit) notFound();
  return <UnitPage subject={subject} unit={unit} />;
}
