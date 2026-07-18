import { FlashcardDeck } from "@/components/FlashcardDeck";
import { getSubject, getUnit } from "@/lib/content-db";
import { notFound } from "next/navigation";

export default async function CardsPage({ params }: { params: Promise<{ subject: string; slug: string }> }) {
  const { subject: subjectSlug, slug } = await params;
  const subject = await getSubject(subjectSlug);
  const unit = subject ? await getUnit(subjectSlug, slug) : undefined;
  if (!subject || !unit || (unit.flashcards?.length ?? 0) === 0) notFound();
  return <FlashcardDeck subject={subjectSlug} unit={unit} />;
}
