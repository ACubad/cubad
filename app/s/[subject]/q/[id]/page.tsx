import { notFound } from "next/navigation";
import { getQuestion, getQuestionOrder, getSubject, getSubjects } from "@/lib/content";
import { Walkthrough } from "@/components/Walkthrough";

export function generateStaticParams() {
  return getSubjects().flatMap((s) =>
    getQuestionOrder(s.slug).map((q) => ({ subject: s.slug, id: q.id }))
  );
}

export default async function QuestionPage({
  params,
}: {
  params: Promise<{ subject: string; id: string }>;
}) {
  const { subject: subjectSlug, id } = await params;
  const subject = getSubject(subjectSlug);
  const found = getQuestion(subjectSlug, id);
  if (!subject || !found) notFound();

  const order = getQuestionOrder(subjectSlug);
  const idx = order.findIndex((q) => q.id === id);
  const prev = idx > 0 ? order[idx - 1].id : null;
  const next = idx < order.length - 1 ? order[idx + 1].id : null;

  return (
    <Walkthrough
      subject={subjectSlug}
      unitTitle={found.unit.title}
      unitSlug={found.unit.slug}
      question={found.question}
      prevId={prev}
      nextId={next}
      hasQuiz={subject.kind === "walkthrough"}
    />
  );
}
