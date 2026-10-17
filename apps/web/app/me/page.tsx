import type { Metadata } from "next";
import { Page } from "../../components/ui";
import { loadMe } from "../../components/onboarding/load-me";
import { parseMeState } from "../../components/onboarding/logic";
import { Onboarding } from "../../components/onboarding/onboarding";

export const metadata: Metadata = {
  title: "Mon compte de paiement · BitBounty",
  description: "Relie ton compte Wave ou Orange Money une seule fois pour recevoir tes bounties.",
};

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** /me: the developer links their payout account once (French, phone-first). `?state=new|pending|sms_ok|verified` for demos. */
export default async function MePage({ searchParams }: Props) {
  const state = parseMeState((await searchParams)?.state);
  const me = loadMe(state);
  const initials = me.user.name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("");
  return (
    <Page
      width="narrow"
      nav={{ items: [{ href: "/", label: "Bounties" }, { href: "/me", label: "Mon compte" }], active: "/me", initials }}
    >
      {/* key: a new ?state= remounts the flow at the right step */}
      <Onboarding key={state ?? "default"} me={me} />
    </Page>
  );
}
