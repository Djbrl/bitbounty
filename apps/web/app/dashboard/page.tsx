import type { Metadata } from "next";
import { getDashboard } from "@/components/dashboard/data";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard · BitBounty" };

// Rendered per request: the data comes from the server (I1), never baked in at build time.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return <DashboardView data={await getDashboard()} />;
}
