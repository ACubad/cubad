import { PracticeRunner } from "@/components/PracticeRunner";
import { getAccess } from "@/lib/access/access";
import { getSubjectCatalog, getUnitContent } from "@/lib/content-db";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PracticePage({ params }: { params: Promise<{ subject: string; slug: string }> }) {
  const { subject: subjectSlug, slug } = await params;
  const catalog = await getSubjectCatalog(subjectSlug);
  const meta = catalog?.units.find((entry) => entry.slug === slug);
  if (!catalog || !meta) notFound();
  if (!(await getAccess(catalog.subject.id, meta.id)).canStudy) {
    redirect(`/s/${subjectSlug}/unit/${slug}`);
  }
  const unit = await getUnitContent(subjectSlug, slug);
  if (!unit || (unit.practice?.length ?? 0) === 0) notFound();
  return <PracticeRunner subject={subjectSlug} unit={unit} />;
}
