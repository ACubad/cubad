import { notFound } from "next/navigation";
import { getUnit, getUnits } from "@/lib/content";
import { QuizRunner } from "@/components/QuizRunner";

export function generateStaticParams() {
  return getUnits().map((u) => ({ slug: u.slug }));
}

export default async function QuizPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const unit = getUnit(slug);
  if (!unit) notFound();
  return <QuizRunner unit={unit} />;
}
