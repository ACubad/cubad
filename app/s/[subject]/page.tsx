import { SubjectHome } from "@/components/SubjectHome";
import { getSubject, getUnits } from "@/lib/content-db";
import { notFound } from "next/navigation";

export default async function SubjectHomePage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject: subjectSlug } = await params;
  const subject = await getSubject(subjectSlug);
  if (!subject) notFound();
  return <SubjectHome subject={subject} units={await getUnits(subjectSlug)} />;
}
