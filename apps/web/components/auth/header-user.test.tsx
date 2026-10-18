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

  it("renders nothing when off or loading, a sign-in link when out, the user when in", () => {
    expect(renderToStaticMarkup(<HeaderUserView session={null} />)).toBe("");
    expect(renderToStaticMarkup(<HeaderUserView session={{ kind: "off" }} />)).toBe("");
    const out = renderToStaticMarkup(<HeaderUserView session={{ kind: "out" }} path="/pay/b-101?batch=a,b" />);
    expect(out).toContain("Sign in with GitHub");
    expect(out).toContain(`href="/signin?callbackUrl=%2Fpay%2Fb-101%3Fbatch%3Da%2Cb"`);
    const signedIn = renderToStaticMarkup(
      <HeaderUserView session={{ kind: "in", user: { githubId: 1, login: "awa-ndiaye", avatarUrl: null } }} />,
    );
    expect(signedIn).toContain("@awa-ndiaye");
    expect(signedIn).toContain("Sign out");
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
    expect(html).not.toContain("Sign in");
  });
});
