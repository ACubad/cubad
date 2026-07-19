import { getPaymentInstructions } from "@/lib/payments/settings";
import { SettingsForm } from "./SettingsForm";

export default async function PaymentSettingsPage() {
  return <SettingsForm initial={await getPaymentInstructions()} />;
}
