import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { greeting, INSTALL_URL, modeOfPath, navFor, parseLang, parseMode, resolveMode } from "./mode";
import { AppShell, type AppShellProps } from "./shell";

const path = vi.hoisted(() => ({ current: "/app/hunt" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

const noop = async () => {};
const render = (over: Partial<AppShellProps> = {}, at = "/app/hunt") => {
  path.current = at;
  return renderToStaticMarkup(
    <AppShell user={{ login: "awa-ndiaye", name: "Awa Ndiaye", avatarUrl: null }} lang="fr" canMaintain authOn={false} switchMode={noop} {...over}>
      <p>page body</p>
    </AppShell>,
  );
};

describe("U2 shell helpers", () => {
  it("parses modes and languages", () => {
    expect(parseMode("hunt")).toBe("hunt");
    expect(parseMode("maintain")).toBe("maintain");
    expect(parseMode("admin")).toBeNull();
    expect(parseMode(undefined)).toBeNull();
    expect(parseLang("en")).toBe("en");
    expect(parseLang(undefined)).toBe("fr");
  });

  it("resolves /app: server, then cookie, then hunt; never maintain without a repo", () => {
    expect(resolveMode(null, null, true)).toBe("hunt");
    expect(resolveMode(null, "maintain", true)).toBe("maintain");
    expect(resolveMode("hunt", "maintain", true)).toBe("hunt");
    expect(resolveMode("maintain", null, false)).toBe("hunt");
  });

  it("knows the workspace of a path", () => {
    expect(modeOfPath("/app/maintain")).toBe("maintain");
    expect(modeOfPath("/app/maintain/repos")).toBe("maintain");
    expect(modeOfPath("/app/hunt")).toBe("hunt");
    expect(modeOfPath("/app/maintainers")).toBe("hunt");
  });

  it("greets in the user's language, first name only", () => {
    expect(greeting("fr", "Awa Ndiaye")).toBe("Salut Awa 👋");
    expect(greeting("en", "Awa Ndiaye")).toBe("Hi Awa 👋");
    expect(greeting("fr", null)).toBe("Salut 👋");
  });

  it("has the five entries of each workspace", () => {
    expect(navFor("hunt", "awa", "en").map((i) => i.label)).toEqual(["Home", "Explore", "My claims", "Earnings", "Profile"]);
    expect(navFor("hunt", "awa", "en").at(-1)?.href).toBe("/u/awa");
    expect(navFor("maintain", "awa", "en").map((i) => i.label)).toEqual(["Home", "Repos", "Review queue", "Payouts", "Price my backlog"]);
  });
});

describe("U2 AppShell", () => {
  it("renders the greeting, the hunter sidebar and the page", () => {
    const html = render();
    expect(html).toContain("Salut Awa 👋");
    expect(html).toContain('href="/explore"');
    expect(html).toContain('href="/u/awa-ndiaye"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("page body");
    expect(html).toContain('id="app-content"');
  });

  it("follows the URL for the maintainer sidebar", () => {
    const html = render({ lang: "en" }, "/app/maintain");
    expect(html).toContain("Hi Awa 👋");
    expect(html).toContain("Review queue");
    expect(html).toContain('href="/app/maintain#backlog"');
    expect(html).not.toContain("My claims");
  });

  it("offers both workspaces with a repo, the install link without", () => {
    const withRepo = render();
    expect(withRepo).toContain('value="maintain"');
    expect(withRepo).toContain('aria-pressed="true"');
    const installLinks = (html: string) => html.split(`href="${INSTALL_URL}"`).length - 1;
    expect(installLinks(withRepo)).toBe(1); // the header CTA only
    const without = render({ canMaintain: false });
    expect(without).not.toContain('value="maintain"');
    expect(installLinks(without)).toBe(2); // header CTA + the sidebar hint
    expect(without).toContain("Installer sur GitHub");
  });

  it("puts Installer sur GitHub (new tab) and the account menu in the header, nothing else", () => {
    const html = render();
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toMatch(new RegExp(`<a href="${INSTALL_URL}" target="_blank" rel="noopener noreferrer"[^>]*bg-money[^>]*>Installer sur GitHub</a>`));
    expect(header).toContain('aria-label="Menu du compte"');
    expect(header).not.toContain("Se connecter");
    expect(header.match(/<a /g)).toHaveLength(2); // the mark (phone) + the install CTA
  });
});
