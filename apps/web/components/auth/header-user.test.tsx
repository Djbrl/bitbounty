import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Page } from "../ui";
import { HeaderUserView, loadHeaderSession, signInHref } from "./HeaderUser";

describe("header sign-in", () => {
  it("is off when /api/auth/session is not OK (no AUTH_SECRET) or unreachable", async () => {
    expect(await loadHeaderSession(vi.fn(async () => Response.json({ error: "auth_disabled" }, { status: 404 })))).toEqual({
      kind: "off",
    });
    expect(
      await loadHeaderSession(
        vi.fn(async () => {
          throw new Error("offline");
        }),
      ),
    ).toEqual({ kind: "off" });
  });

  it("is signed out on an empty session and signed in with our user fields", async () => {
    expect(await loadHeaderSession(vi.fn(async () => Response.json(null)))).toEqual({ kind: "out" });
    const user = { githubId: 42, login: "Djbrl", avatarUrl: "https://avatars.githubusercontent.com/u/42" };
    expect(await loadHeaderSession(vi.fn(async () => Response.json({ user, expires: "x" })))).toEqual({ kind: "in", user });
  });

  it("holds the place while loading, Se connecter when out or off, the user when in", () => {
    const loading = renderToStaticMarkup(<HeaderUserView session={null} />);
    expect(loading).toContain('aria-hidden="true"');
    expect(loading).toContain("invisible");
    expect(loading).not.toContain("<a");
    expect(renderToStaticMarkup(<HeaderUserView session={{ kind: "off" }} />)).toContain('href="/signin?callbackUrl=%2F"');
    const out = renderToStaticMarkup(<HeaderUserView session={{ kind: "out" }} path="/pay/b-101?batch=a,b" />);
    expect(out).toContain(">Se connecter</a>");
    expect(out).toContain("border-rule"); // secondary pill
    expect(out).toContain(`href="/signin?callbackUrl=%2Fpay%2Fb-101%3Fbatch%3Da%2Cb"`);
    const signedIn = renderToStaticMarkup(
      <HeaderUserView session={{ kind: "in", user: { githubId: 1, login: "awa-ndiaye", avatarUrl: null } }} />,
    );
    expect(signedIn).toContain("@awa-ndiaye");
    expect(signedIn).toContain("cursor-pointer"); // reads as clickable
    expect(signedIn).toContain('href="/u/awa-ndiaye"');
    expect(signedIn).toContain('href="/me"'); // Lightning Address lives in the profile menu
    expect(signedIn).toContain("Se déconnecter");
    const en = renderToStaticMarkup(
      <HeaderUserView lang="en" session={{ kind: "in", user: { githubId: 1, login: "awa-ndiaye", avatarUrl: null } }} />,
    );
    expect(en).toContain("Sign out");
    expect(en).toContain("Payout address");
  });

  it("never builds an off-site callback", () => {
    expect(signInHref("//evil.example")).toBe("/signin?callbackUrl=%2F");
  });

  it("Page with a nav still renders statically (menu fills in on the client)", () => {
    const html = renderToStaticMarkup(
      <Page nav={{ items: [{ href: "/", label: "Board" }] }}>
        <p>hi</p>
      </Page>,
    );
    expect(html).toContain("Board");
    expect(html).not.toContain('href="/signin');
  });

  it("Page's header has exactly two CTAs: Installer sur GitHub (primary, new tab), then Se connecter", () => {
    const html = renderToStaticMarkup(
      <Page nav={{ items: [{ href: "/explore", label: "Board" }], initials: "AN", right: <HeaderUserView session={{ kind: "out" }} /> }}>
        <p>hi</p>
      </Page>,
    );
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    const pills = [...header.matchAll(/<a [^>]*rounded-full[^>]*>([^<]*)<\/a>/g)];
    expect(pills.map((m) => m[1])).toEqual(["Installer sur GitHub", "Se connecter"]);
    expect(pills[0]![0]).toContain('href="https://github.com/apps/bitbounty-dakar"');
    expect(pills[0]![0]).toContain('target="_blank"');
    expect(pills[0]![0]).toContain("bg-money");
    expect(header).not.toContain(">AN<"); // no stand-in avatar next to the CTAs
  });
});
