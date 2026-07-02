import { getUnits } from "@/lib/content";
import { HomeView } from "@/components/HomeView";

export default function HomePage() {
  const units = getUnits();
  return <HomeView units={units} />;
}
