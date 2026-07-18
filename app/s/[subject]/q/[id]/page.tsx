import { Walkthrough } from "@/components/Walkthrough";
import { getQuestion, getQuestionOrder, getSubject } from "@/lib/content-db";
import { notFound } from "next/navigation";

export default async function QuestionPage({ params }: { params: Promise<{ subject: string; id: string }> }) {
  const { subject: subjectSlug, id } = await params;
  const subject = await getSubject(subjectSlug);
  const found = subject ? await getQuestion(subjectSlug, id) : undefined;
  if (!subject || !found) notFound();
  const order = await getQuestionOrder(subjectSlug);
  const index = order.findIndex((question) => question.id === id);
  const prev = index > 0 ? order[index - 1].id : null;
  const next = index < order.length - 1 ? order[index + 1].id : null;
  return <Walkthrough subject={subjectSlug} unitTitle={found.unit.title} unitSlug={found.unit.slug} question={found.question} prevId={prev} nextId={next} hasQuiz={(found.unit.quiz?.length ?? 0) > 0} />;
}
