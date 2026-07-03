import { notFound } from "next/navigation";
import { getSubject, getSubjects, getUnits } from "@/lib/content";
import { HomeView } from "@/components/HomeView";
import { StudyHomeView } from "@/components/StudyHomeView";

export function generateStaticParams() {
  return getSubjects().map((s) => ({ subject: s.slug }));
}

export default async function SubjectHomePage({
  params,
}: {
  params: Promise<{ subject: string }>;
}) {
  const { subject: subjectSlug } = await params;
  const subject = getSubject(subjectSlug);
  if (!subject) notFound();
  const units = getUnits(subjectSlug);

  if (subject.kind === "walkthrough") {
    return <HomeView subject={subjectSlug} units={units} />;
  }
  return <StudyHomeView subject={subject} units={units} />;
}
