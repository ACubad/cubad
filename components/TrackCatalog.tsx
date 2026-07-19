import "server-only";

import Link from "next/link";
import { getMyTrackSubjects } from "@/lib/access/access";
import { SubjectTitle } from "./SubjectTitle";
import { TrackCatalogHeading } from "./TrackCatalogHeading";

export async function TrackCatalog() {
  const subjects = await getMyTrackSubjects();
  if (!subjects.length) return null;
  return (
    <section className="rise-in pt-4 sm:pt-8">
      <TrackCatalogHeading />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {subjects.map((subject) => (
          <Link
            key={subject.id}
            href={`/s/${subject.slug}`}
            className="group rounded-2xl border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"
          >
            <SubjectTitle title={subject.title} tagline={subject.tagline} />
          </Link>
        ))}
      </div>
    </section>
  );
}
