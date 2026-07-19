import { Walkthrough } from "@/components/Walkthrough";
import { getAccess } from "@/lib/access/access";
import { getSubjectCatalog, getUnitContent } from "@/lib/content-db";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function QuestionPage({ params }: { params: Promise<{ subject: string; id: string }> }) {
  const { subject: subjectSlug, id } = await params;
  const catalog = await getSubjectCatalog(subjectSlug);
  const meta = catalog?.units.find((unit) => unit.questionIds.includes(id));
  if (!catalog || !meta) notFound();
  if (!(await getAccess(catalog.subject.id, meta.id)).canStudy) {
    redirect(`/s/${subjectSlug}/unit/${meta.slug}`);
  }
  const unit = await getUnitContent(subjectSlug, meta.slug);
  const question = unit?.questions?.find((entry) => entry.id === id);
  if (!unit || !question) notFound();
  const order = catalog.units.flatMap((entry) => entry.questionIds);
  const index = order.indexOf(id);
  const prev = index > 0 ? order[index - 1] : null;
  const next = index >= 0 && index < order.length - 1 ? order[index + 1] : null;
  return <Walkthrough subject={subjectSlug} unitTitle={unit.title} unitSlug={unit.slug} question={question} prevId={prev} nextId={next} hasQuiz={(unit.quiz?.length ?? 0) > 0} />;
}
