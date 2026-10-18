// Server-side data for /dashboard. Today it calls the F4 mock handler directly (works in `next build`
// with no server running); I1 swaps this function for the real API without touching the UI.
import bounties from "../../../../fixtures/bounties.json";
import dashboard from "../../../../fixtures/dashboard.json";
import funding from "../../../../fixtures/funding.json";
import { load } from "../../lib/api";
import { handleMock, type Fixtures } from "../../lib/mock-api";
import { sessionLogin } from "../../lib/session-login";
import type { DashboardData } from "./shape";

// Only the fixtures the dashboard route reads; keeps the other JSON out of this page.
const fx = { bounties, dashboard, funding } as unknown as Fixtures;

/** GET /api/dashboard */
export async function getDashboard(): Promise<DashboardData> {
  const data = await load<DashboardData>(
    "/api/dashboard",
    () => {
      const res = handleMock(fx, "GET", ["dashboard"], new URLSearchParams());
      return "json" in res && res.status === 200 ? (res.json as DashboardData) : null;
    },
    { user: await sessionLogin() },
  );
  if (!data) throw new Error("dashboard_unavailable");
  return data;
}
