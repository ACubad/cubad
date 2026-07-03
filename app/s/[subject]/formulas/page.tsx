import { notFound } from "next/navigation";
import { getSubject, getSubjects, getUnits } from "@/lib/content";
import { FormulasView } from "@/components/FormulasView";

export function generateStaticParams() {
  return getSubjects()
    .filter((s) => getUnits(s.slug).some((u) => (u.concept?.keyFormulas?.length ?? 0) > 0))
    .map((s) => ({ subject: s.slug }));
}

export default async function FormulasPage({
  params,
}: {
  params: Promise<{ subject: string }>;
}) {
  const { subject: subjectSlug } = await params;
  const subject = getSubject(subjectSlug);
  if (!subject) notFound();
  const units = getUnits(subjectSlug);
  const hasFormulas = units.some((u) => (u.concept?.keyFormulas?.length ?? 0) > 0);
  if (!hasFormulas) notFound();
  return <FormulasView units={units} />;
}
