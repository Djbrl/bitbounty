import type { Metadata } from "next";
import { Page } from "../../components/ui";
import { fetchMe } from "../../components/onboarding/load-me";
import { parseMeState } from "../../components/onboarding/logic";
import { Onboarding } from "../../components/onboarding/onboarding";

// Rendered per request: the data comes from the server (I1), never baked in at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mon compte de paiement · BitBounty",
  description: "Ajoute ta Lightning Address une seule fois pour recevoir tes bounties en sats.",
};

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** /me: the developer saves their Lightning Address once (French). `?state=new` (no address) or `?state=verified` for demos. */
export default async function MePage({ searchParams }: Props) {
  const state = parseMeState((await searchParams)?.state);
  const me = await fetchMe(state);
  const initials = me.user.name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("");
  return (
    <Page
      width="narrow"
      nav={{ items: [{ href: "/explore", label: "Bounties" }, { href: "/me", label: "Mon compte" }], active: "/me", initials }}
    >
      {/* key: a new ?state= remounts the flow at the right step */}
      <Onboarding key={state ?? "default"} me={me} />
    </Page>
  );
}
