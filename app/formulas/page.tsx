import { getUnits } from "@/lib/content";
import { FormulasView } from "@/components/FormulasView";

export default function FormulasPage() {
  const units = getUnits();
  return <FormulasView units={units} />;
}
