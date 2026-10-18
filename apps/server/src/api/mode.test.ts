import { createBounty } from "@bitbounty/core";
import { describe, expect, it } from "vitest";
import { InMemoryBountyRepo } from "../bounties/repo.js";
import { InMemoryModeStore, modeRoutes } from "./mode.js";

const TOKEN = "internal-secret-token";

function setup(installs: Record<string, string[]> = {}) {
  const repo = new InMemoryBountyRepo();
  const routes = modeRoutes({ store: new InMemoryModeStore(installs), repo, internalToken: TOKEN });
  const auth = (user: string) => ({ authorization: `Bearer ${TOKEN}`, "x-bitbounty-user": user });
  const get = (user?: string) => routes.request("/api/me/mode", { headers: user ? auth(user) : {} });
  const post = (user: string | undefined, body: unknown) =>
    routes.request("/api/me/mode", {
      method: "POST",
      headers: { ...(user ? auth(user) : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { repo, get, post };
}

describe("U2 /api/me/mode", () => {
  it("is 401 without a trusted user", async () => {
    const { get, post } = setup();
    expect((await get()).status).toBe(401);
    expect((await post(undefined, { mode: "hunt" })).status).toBe(401);
  });

  it("starts with no mode and no repos", async () => {
    const { get } = setup();
    expect(await (await get("awa")).json()).toEqual({ defaultMode: null, installedRepos: [] });
  });

  it("remembers the mode per user (case-insensitive login)", async () => {
    const { get, post } = setup();
    const res = await post("Awa", { mode: "maintain" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ defaultMode: "maintain" });
    expect((await (await get("awa")).json()).defaultMode).toBe("maintain");
    expect((await (await get("moussa")).json()).defaultMode).toBeNull();
  });

  it("rejects an unknown mode", async () => {
    const { post } = setup();
    const res = await post("awa", { mode: "admin" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_mode");
  });

  it("lists installed repos plus repos the user funded bounties on", async () => {
    const { repo, get } = setup({ awa: ["awa/app"] });
    const { bounty } = createBounty({
      id: "00000000-0000-4000-8000-000000000001",
      repoFullName: "teranga-labs/bitnob-js",
      issueNumber: 1,
      issueTitle: "Issue 1",
      amountXof: 10_000,
      criteria: [],
      funderKind: "human",
      funderId: "github:awa",
      createdAt: "2026-10-17T10:00:00.000Z",
    });
    await repo.create(bounty);
    expect((await (await get("awa")).json()).installedRepos).toEqual(["awa/app", "teranga-labs/bitnob-js"]);
    expect((await (await get("moussa")).json()).installedRepos).toEqual([]);
  });
});
