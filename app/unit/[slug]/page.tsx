import { notFound } from "next/navigation";
import { getUnit, getUnits } from "@/lib/content";
import { UnitView } from "@/components/UnitView";

export function generateStaticParams() {
  return getUnits().map((u) => ({ slug: u.slug }));
}

export default async function UnitPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const unit = getUnit(slug);
  if (!unit) notFound();
  return <UnitView unit={unit} />;
}
