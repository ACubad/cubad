import { notFound } from "next/navigation";
import { getSubject, getSubjects, getUnit, getUnits } from "@/lib/content";
import { FlashcardDeck } from "@/components/FlashcardDeck";

export function generateStaticParams() {
  return getSubjects()
    .filter((s) => s.kind === "study")
    .flatMap((s) => getUnits(s.slug).map((u) => ({ subject: s.slug, slug: u.slug })));
}

export default async function CardsPage({
  params,
}: {
  params: Promise<{ subject: string; slug: string }>;
}) {
  const { subject: subjectSlug, slug } = await params;
  const subject = getSubject(subjectSlug);
  const unit = getUnit(subjectSlug, slug);
  if (!subject || !unit || subject.kind !== "study") notFound();
  return <FlashcardDeck subject={subjectSlug} unit={unit} />;
}
