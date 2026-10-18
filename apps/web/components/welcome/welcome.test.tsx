import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import dashboard from "../../../../fixtures/dashboard.json";
import me from "../../../../fixtures/me.json";
import users from "../../../../fixtures/users.json";
import type { OnboardingState } from "../../../../fixtures/types";
import WelcomePage from "../../app/welcome/page";
import { handleMock, resetMockOnboarding, type Fixtures } from "../../lib/mock-api";
import { fetchOnboarding } from "./load";
import { APP_HREF, initialRole, initialStack, initialStep, modeForRole, showsHunter, showsMaintainer, stackOptions, toggle } from "./logic";
import { WelcomeFlow } from "./welcome-flow";

const fx = { me, users, dashboard } as unknown as Fixtures;
const post = (path: string, body: Record<string, unknown>) => handleMock(fx, "POST", path.split("/"), new URLSearchParams(), body);

beforeEach(() => resetMockOnboarding());

describe("welcome logic", () => {
  it("resumes from ?step=, else the saved step, else 1", () => {
    expect(initialStep("2", 1)).toBe(2);
    expect(initialStep(["3"], 1)).toBe(3);
    expect(initialStep("9", 2)).toBe(2);
    expect(initialStep(undefined, 3)).toBe(3);
    expect(initialStep("x", undefined)).toBe(1);
  });

  it("pre-selects the role from what was saved, else the landing intent", () => {
    expect(initialRole("both", "hunt")).toBe("both");
    expect(initialRole(null, "maintain")).toBe("maintain");
    expect(initialRole(null, null)).toBeNull();
  });

  it("maps a role to the saved workspace", () => {
    expect(modeForRole("maintain", null)).toBe("maintain");
    expect(modeForRole("both", "maintain")).toBe("maintain");
    expect(modeForRole("both", null)).toBe("hunt");
    expect(showsHunter(null) && showsHunter("both") && !showsHunter("maintain")).toBe(true);
    expect(showsMaintainer("both") && !showsMaintainer("hunt") && !showsMaintainer(null)).toBe(true);
    expect(APP_HREF).toBe("/app");
  });

  it("pre-fills the stack from GitHub languages, saved choices win", () => {
    const base = { githubLanguages: ["TypeScript", "Go"], preferences: { stack: [] as string[] } } as unknown as OnboardingState;
    expect(initialStack(base)).toEqual(["TypeScript", "Go"]);
    expect(initialStack({ ...base, preferences: { ...base.preferences, stack: ["Rust"] } })).toEqual(["Rust"]);
    expect(initialStack({ ...base, githubLanguages: [] })).toEqual([]);
    const opts = stackOptions(["Elixir", "go"], ["Haskell"]);
    expect(opts.slice(0, 3)).toEqual(["Elixir", "go", "Haskell"]);
    expect(opts.filter((o) => o.toLowerCase() === "go")).toHaveLength(1);
    expect(toggle(["Go"], "go")).toEqual([]);
    expect(toggle(["Go"], "Rust")).toEqual(["Go", "Rust"]);
  });
});

describe("/welcome in fixtures mode", () => {
  const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await WelcomePage({ searchParams: Promise.resolve(params) }));

  it("step 1: the three role cards, the landing intent pre-selected", async () => {
    const html = await render({ intent: "maintain" });
    expect(html).toContain("ÉTAPE 1 / 3");
    expect(html).toContain("Bienvenue @awa-ndiaye");
    expect(html).toMatch(/aria-checked="true"[^>]*data-role="maintain"/);
    expect(html).toContain("Les deux");
    expect(html).toContain("Passer");
    expect(html).toContain('aria-current="step"');
  });

  it("resumes at the saved step after a reload", async () => {
    post("me/onboarding", { preferences: { role: "both", step: 2 } });
    const html = await render();
    expect(html).toContain("ÉTAPE 2 / 3");
    // Hunter part: GitHub languages pre-selected, currency and language.
    expect(html).toMatch(/aria-pressed="true"[^>]*>TypeScript/);
    expect(html).toContain("Naira (₦)");
    expect(html).toContain("English");
    // Maintainer part: installed repos + install button.
    expect(html).toContain("teranga-labs/bitnob-js");
    expect(html).toContain('href="https://github.com/apps/bitbounty-dakar"');
    expect(html).toContain("Retour");
  });

  it("step 3: Lightning Address for hunters, backlog / first bounty for maintainers", async () => {
    post("me/onboarding", { preferences: { role: "both", repo: "teranga-labs/xof", step: 3 } });
    const html = await render();
    expect(html).toContain('placeholder="toi@blink.sv"');
    expect(html).toContain("Chiffrer mon backlog");
    expect(html).toContain('href="https://github.com/teranga-labs/xof/issues"');
    expect(html).toContain("Terminer");
    post("me/lightning-address", { lightningAddress: "awa@blink.sv" });
    expect(await render()).toContain("aw***@blink.sv");
  });

  it("an onboarded user goes straight to /app", async () => {
    post("me/onboarding", { done: true });
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining(";/app;") });
    expect(await render({ again: "1" })).toContain("ÉTAPE");
  });

  it("the loader returns the mock state, with GitHub languages", async () => {
    expect(await fetchOnboarding()).toMatchObject({ login: "awa-ndiaye", githubLanguages: ["TypeScript", "Go"], onboardedAt: null });
  });

  it("maintainer-only: no stack chips, no Lightning Address", () => {
    const st = handleMock(fx, "GET", ["me", "onboarding"], new URLSearchParams());
    const initial = { ...("json" in st ? (st.json as OnboardingState) : ({} as OnboardingState)), preferences: { role: "maintain", stack: [], currency: "xof", language: "fr", repo: null, step: 3 } } as OnboardingState;
    const html = renderToStaticMarkup(<WelcomeFlow initial={initial} intent={null} step={3} />);
    expect(html).not.toContain("toi@blink.sv");
    expect(html).toContain("Votre premier bounty");
  });
});
