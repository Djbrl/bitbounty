import type { Metadata } from "next";
import { getDashboard } from "@/components/dashboard/data";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard · BitBounty" };

export default async function DashboardPage() {
  return <DashboardView data={await getDashboard()} />;
}
