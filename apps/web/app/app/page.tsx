// U2: /app lands on the user's saved workspace (users.default_mode, then this device), Hunter by default.
import { redirect } from "next/navigation";
import { loadShell } from "@/components/app-shell/data";

export const dynamic = "force-dynamic";

export default async function AppIndex() {
  const { mode } = await loadShell();
  redirect(`/app/${mode}`);
}
