import { describe, expect, it, vi } from "vitest";
import { fetchPreferences, savePreferences } from "./preferences";

const env = { BITBOUNTY_API_URL: "https://api.example/", INTERNAL_API_TOKEN: "tok" };
const saved = { defaultMode: "maintain", onboardedAt: "2026-10-18T09:00:00.000Z" };

describe("server copy of the onboarding fields", () => {
  it("reads them with the internal token and the user's login", async () => {
    const f = vi.fn(async () => Response.json(saved));
    expect(await fetchPreferences("awa", env, f)).toEqual(saved);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/api/me/preferences");
    expect(init.headers).toMatchObject({ authorization: "Bearer tok", "x-bitbounty-user": "awa" });
  });

  it("writes the mode with PUT and returns what the server stored", async () => {
    const f = vi.fn(async () => Response.json(saved));
    expect(await savePreferences("awa", "maintain", env, f)).toEqual(saved);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ defaultMode: "maintain" });
  });

  it("without a server (fixtures) or token: no call, not onboarded / not saved", async () => {
    const f = vi.fn();
    expect(await fetchPreferences("awa", {}, f)).toEqual({ defaultMode: null, onboardedAt: null });
    expect(await savePreferences("awa", "hunt", { BITBOUNTY_API_URL: "https://api.example" }, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("a failing or unreachable server never breaks sign-in", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchPreferences("awa", env, vi.fn(async () => Response.json({ error: "x" }, { status: 500 })))).toEqual({
      defaultMode: null,
      onboardedAt: null,
    });
    expect(
      await savePreferences(
        "awa",
        "hunt",
        env,
        vi.fn(async () => {
          throw new Error("offline");
        }),
      ),
    ).toBeNull();
    warn.mockRestore();
  });
});
