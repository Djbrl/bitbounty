import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/auth", () => ({ UserMenu: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

import SignInPage from "./page";

const open = (error: string) => SignInPage({ searchParams: Promise.resolve({ error, callbackUrl: "/app/maintain" }) });

describe("/signin", () => {
  it("a sign-in cancelled (or refused) on GitHub goes back to the landing, no error page", async () => {
    for (const code of ["OAuthCallbackError", "AccessDenied"]) {
      await expect(open(code)).rejects.toMatchObject({ to: "/" });
    }
  });

  it("still explains real errors", async () => {
    const html = renderToStaticMarkup(await open("Configuration"));
    expect(html).toContain('role="alert"');
    expect(html).toContain("misconfigured");
  });
});
