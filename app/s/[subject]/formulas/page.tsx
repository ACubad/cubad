import { FormulasView } from "@/components/FormulasView";
import { getSubjectPageAccess } from "@/lib/access/access";
import { getSubjectCatalog, getUnits } from "@/lib/content-db";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FormulasPage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject: subjectSlug } = await params;
  const catalog = await getSubjectCatalog(subjectSlug);
  if (!catalog) notFound();
  if (!(await getSubjectPageAccess(catalog.subject.id))) redirect(`/s/${subjectSlug}`);
  const units = await getUnits(subjectSlug);
  if (!units.some((unit) => (unit.concept?.keyFormulas?.length ?? 0) > 0)) notFound();
  return <FormulasView units={units} />;
}
