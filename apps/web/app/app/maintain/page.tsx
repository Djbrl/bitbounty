// U2: Maintainer home inside the app shell. Placeholder that reuses the /dashboard view; U4 redesigns it.
import type { Metadata } from "next";
import Link from "next/link";
import { getDashboard } from "@/components/dashboard/data";
import { DashboardContent } from "@/components/dashboard/dashboard-view";
import { EmptyState, buttonClass } from "@/components/ui";
import { INSTALL_URL } from "@/components/app-shell/mode";

export const metadata: Metadata = { title: "Maintainer · BitBounty" };
export const dynamic = "force-dynamic";

export default async function MaintainHome() {
  const data = await getDashboard();
  if (!data.repos.length && !data.bounties.length) {
    return (
      <EmptyState
        title="No repo yet"
        action={
          <Link href={INSTALL_URL} className={buttonClass({ variant: "dark" })}>
            Install on GitHub
          </Link>
        }
      >
        Install the BitBounty app on a repo, then price your backlog and fund an issue.
      </EmptyState>
    );
  }
  return <DashboardContent data={data} />;
}
