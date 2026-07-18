import { FormulasView } from "@/components/FormulasView";
import { getSubject, getUnits } from "@/lib/content-db";
import { notFound } from "next/navigation";

export default async function FormulasPage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject: subjectSlug } = await params;
  const subject = await getSubject(subjectSlug);
  if (!subject) notFound();
  const units = await getUnits(subjectSlug);
  if (!units.some((unit) => (unit.concept?.keyFormulas?.length ?? 0) > 0)) notFound();
  return <FormulasView units={units} />;
}
