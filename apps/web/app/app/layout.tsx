// U2: the signed-in app shell around every /app page (middleware requires a GitHub session).
import type { ReactNode } from "react";
import { switchMode } from "@/components/app-shell/actions";
import { loadShell } from "@/components/app-shell/data";
import { AppShell } from "@/components/app-shell/shell";

// Per request: the user, their workspace and their repos come from the session and the server.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, lang, canMaintain, authOn } = await loadShell();
  return (
    <AppShell user={user} lang={lang} canMaintain={canMaintain} authOn={authOn} switchMode={switchMode}>
      {children}
    </AppShell>
  );
}
