import { notFound } from "next/navigation";
import { getQuestion, getQuestionOrder } from "@/lib/content";
import { Walkthrough } from "@/components/Walkthrough";

export function generateStaticParams() {
  return getQuestionOrder().map((q) => ({ id: q.id }));
}

export default async function QuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const found = getQuestion(id);
  if (!found) notFound();

  const order = getQuestionOrder();
  const idx = order.findIndex((q) => q.id === id);
  const prev = idx > 0 ? order[idx - 1].id : null;
  const next = idx < order.length - 1 ? order[idx + 1].id : null;

  return (
    <Walkthrough
      unitTitle={found.unit.title}
      unitSlug={found.unit.slug}
      question={found.question}
      prevId={prev}
      nextId={next}
    />
  );
}
