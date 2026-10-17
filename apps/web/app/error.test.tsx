import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { AUTH_ERROR_DIGEST } from "@/lib/api";
import PageError from "./error";

const render = (error: Error & { digest?: string }) => renderToStaticMarkup(<PageError error={error} reset={() => {}} />);

describe("error page", () => {
  it("a 401/403 in production (message stripped, digest kept) shows the auth message and a sign-in action", () => {
    const html = render(Object.assign(new Error("An error occurred in the Server Components render."), { digest: AUTH_ERROR_DIGEST }));
    expect(html).toContain("Connexion requise");
    expect(html).toContain("Session expirée ou accès refusé");
    expect(html).toContain('href="/signin?callbackUrl=%2Fdashboard"');
    expect(html).toContain("Se reconnecter avec GitHub");
    expect(html).not.toContain("ne répond pas");
  });

  it("other failures keep the generic message and no sign-in action", () => {
    const html = render(Object.assign(new Error("An error occurred in the Server Components render."), { digest: "2938471" }));
    expect(html).toContain("Impossible de charger la page");
    expect(html).toContain("ne répond pas ou a renvoyé une erreur");
    expect(html).not.toContain("/signin");
  });
});
