import { SubjectHome } from "@/components/SubjectHome";
import { getCurrentPreviewUnitId, getSubjectPageAccess } from "@/lib/access/access";
import { getSubjectCatalog } from "@/lib/content-db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SubjectHomePage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject: subjectSlug } = await params;
  const catalog = await getSubjectCatalog(subjectSlug);
  if (!catalog) notFound();
  const [subjectAccess, previewUnitId] = await Promise.all([
    getSubjectPageAccess(catalog.subject.id),
    getCurrentPreviewUnitId(),
  ]);
  return (
    <SubjectHome
      subject={catalog.subject}
      units={catalog.units}
      subjectAccess={subjectAccess}
      previewUnitId={previewUnitId}
    />
  );
}
