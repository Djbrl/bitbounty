import Link from "next/link";
import { BOUNTY_NAV } from "@/components/bounty/bounty-view";
import { buttonClass, Card, Page } from "@/components/ui";

export default function BountyNotFound() {
  return (
    <Page nav={BOUNTY_NAV} width="narrow">
      <Card padding="lg" className="grid gap-3 text-center">
        <h1 className="text-2xl font-extrabold">Bounty not found</h1>
        <p className="text-muted">This bounty doesn&apos;t exist, or the link is wrong.</p>
        <Link href="/explore" className={buttonClass({ className: "justify-self-center" })}>
          Back to the board
        </Link>
      </Card>
    </Page>
  );
}
