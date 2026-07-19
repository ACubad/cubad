import { UnitPage } from "@/components/UnitPage";
import { PaywallPanel } from "@/components/PaywallPanel";
import { PreviewChoicePanel } from "@/components/PreviewChoicePanel";
import { getAccess, getCurrentPreviewUnitId } from "@/lib/access/access";
import { getSubjectCatalog, getUnitContent } from "@/lib/content-db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function UnitRoutePage({ params }: { params: Promise<{ subject: string; slug: string }> }) {
  const { subject: subjectSlug, slug } = await params;
  const catalog = await getSubjectCatalog(subjectSlug);
  const meta = catalog?.units.find((unit) => unit.slug === slug);
  if (!catalog || !meta) notFound();

  const access = await getAccess(catalog.subject.id, meta.id);
  if (!access.canStudy) {
    const previewUnitId = await getCurrentPreviewUnitId();
    return previewUnitId ? (
      <PaywallPanel subjectSlug={subjectSlug} unitSlug={slug} />
    ) : (
      <PreviewChoicePanel subjectSlug={subjectSlug} unitSlug={slug} />
    );
  }

  const unit = await getUnitContent(subjectSlug, slug);
  if (!unit) notFound();
  return <UnitPage subject={catalog.subject} unit={unit} />;
}
