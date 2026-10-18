import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "../../../components/ui";
import { fetchProfile } from "../../../components/profile/data";
import { ProfileView } from "../../../components/profile/profile-view";

type Props = { params: Promise<{ login: string }> };

// Rendered per request: the data comes from the server (I1), never baked in at build time.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { login } = await params;
  const p = await fetchProfile(decodeURIComponent(login));
  return { title: p ? `${p.user.name} (@${login}) · BitBounty` : "Developer not found · BitBounty" };
}

export default async function ProfilePage({ params }: Props) {
  const { login } = await params;
  const data = await fetchProfile(decodeURIComponent(login));
  if (!data) notFound();
  return (
    <Page nav={{ items: [{ href: "/explore", label: "Board" }, { href: "/live", label: "Live" }] }}>
      <ProfileView data={data} />
    </Page>
  );
}
