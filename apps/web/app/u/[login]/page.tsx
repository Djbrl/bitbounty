import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "../../../components/ui";
import { FIXTURE_LOGINS, loadProfile } from "../../../components/profile/data";
import { ProfileView } from "../../../components/profile/profile-view";

type Props = { params: Promise<{ login: string }> };

export function generateStaticParams() {
  return FIXTURE_LOGINS.map((login) => ({ login }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { login } = await params;
  const p = loadProfile(login);
  return { title: p ? `${p.user.name} (@${login}) · BitBounty` : "Developer not found · BitBounty" };
}

export default async function ProfilePage({ params }: Props) {
  const { login } = await params;
  const data = loadProfile(decodeURIComponent(login));
  if (!data) notFound();
  return (
    <Page nav={{ items: [{ href: "/board", label: "Board" }, { href: "/live", label: "Live" }] }}>
      <ProfileView data={data} />
    </Page>
  );
}
