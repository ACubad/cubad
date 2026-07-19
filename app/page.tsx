import { SubjectPicker } from "@/components/SubjectPicker";
import { TrackCatalog } from "@/components/TrackCatalog";
import { getProfile, getSessionUser } from "@/lib/auth/dal";
import { getSubjectCatalog, getSubjects, type UnitMeta } from "@/lib/content-db";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  if (user) {
    const profile = await getProfile();
    if (!profile?.onboarded_at) redirect("/onboarding");
    return <TrackCatalog />;
  }

  const subjects = await getSubjects();
  const entries = await Promise.all(
    subjects.map(async (subject): Promise<[string, UnitMeta[]]> => [
      subject.slug,
      (await getSubjectCatalog(subject.slug))?.units ?? [],
    ])
  );
  return <SubjectPicker subjects={subjects} unitsBySubject={Object.fromEntries(entries)} />;
}
