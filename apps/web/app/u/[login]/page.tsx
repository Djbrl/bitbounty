import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "../../../components/ui";
import { fetchProfile, initialsOf, shapeProfile, type ProfileView as Data } from "../../../components/profile/data";
import { ProfileView } from "../../../components/profile/profile-view";
import { fetchMe } from "../../../components/onboarding/load-me";
import { authEnabled } from "../../../lib/auth/paths";
import { sessionToUser } from "../../../lib/auth/session-user";

type Props = { params: Promise<{ login: string }> };

// Rendered per request: the data comes from the server (I1), never baked in at build time.
export const dynamic = "force-dynamic";

/** The signed-in user (session, else /api/me) when `login` is theirs (GitHub logins are case-insensitive). */
async function selfUser(login: string): Promise<Data["user"] | null> {
  const same = (l: string | null | undefined) => Boolean(l) && l!.toLowerCase() === login.toLowerCase();
  const me = await fetchMe().catch(() => null);
  if (me && same(me.user.login)) return me.user;
  if (!authEnabled()) return null;
  try {
    const { auth } = await import("../../../auth");
    const s = sessionToUser(await auth());
    if (!s || !same(s.login)) return null;
    return { id: `gh-${s.githubId}`, githubId: s.githubId, login: s.login, avatarUrl: s.avatarUrl, createdAt: new Date().toISOString(), name: s.login, city: "" };
  } catch {
    return null;
  }
}

/** Server profile (exact login, then lowercase); for your own login, an empty profile from the session instead of a 404. */
async function loadProfilePage(raw: string): Promise<Data | null> {
  const login = decodeURIComponent(raw);
  const found = (await fetchProfile(login).catch(() => null)) ?? (login !== login.toLowerCase() ? await fetchProfile(login.toLowerCase()).catch(() => null) : null);
  if (found) return found;
  const user = await selfUser(login);
  if (!user) return null;
  const empty = shapeProfile(
    { user, stats: { paidCount: 0, totalXof: 0, repos: 0, acceptedPct: 0, medianMinutesMergeToPay: 0 }, languages: [], work: [] },
    () => null,
    new Date(),
  );
  return { ...empty, initials: initialsOf(user.name, user.login) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { login } = await params;
  const p = await loadProfilePage(login);
  return { title: p ? `${p.user.name} (@${p.user.login}) · BitBounty` : "Developer not found · BitBounty" };
}

export default async function ProfilePage({ params }: Props) {
  const { login } = await params;
  const data = await loadProfilePage(login);
  if (!data) notFound();
  return (
    <Page nav={{ items: [{ href: "/explore", label: "Board" }, { href: "/live", label: "Live" }] }}>
      <ProfileView data={data} />
    </Page>
  );
}
