import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/session";
import { ExchangeRatesView } from "@/components/management/exchange-rates-view";

export const metadata: Metadata = { title: "Settings" };

/** Exchange-rate management: managers and admins (`exchangeRates.manage`). */
export default async function SettingsPage() {
  await requirePagePermission("exchangeRates.manage");
  return <ExchangeRatesView />;
}
