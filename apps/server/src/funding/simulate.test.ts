import { createBounty } from "@bitbounty/core";
import { describe, expect, it } from "vitest";
import { ActivityLog } from "../api/activity.js";
import { readApiRoutes } from "../api/routes.js";
import { InMemoryBountyRepo } from "../bounties/repo.js";
import { FakeBitnob } from "../e2e/fake-bitnob.js";
import { InMemoryEventBus } from "../github/pr/fakes.js";
import { applyFundingPaid } from "./apply.js";
import { BitnobFunderCustomers } from "./customers.js";
import { LightningFunding } from "./lightning.js";
import { InMemoryFundingStore } from "./store.js";

const ID = "00000000-0000-4000-8000-000000000001";

async function setup(sandbox: boolean | undefined) {
  const repo = new InMemoryBountyRepo();
  const bus = new InMemoryEventBus();
  const activity = new ActivityLog(repo).attach(bus);
  const bitnob = new FakeBitnob();
  const store = new InMemoryFundingStore();
  const lightning = new LightningFunding({
    client: bitnob,
    store,
    rates: bitnob.rates,
    customers: new BitnobFunderCustomers(bitnob),
    bounties: repo,
    emit: applyFundingPaid(repo, bus),
    isSandbox: sandbox === undefined ? undefined : async () => sandbox,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
  const { bounty } = createBounty({
    id: ID,
    repoFullName: "teranga-labs/bitnob-js",
    issueNumber: 1,
    issueTitle: "Issue 1",
    amountXof: 1_000,
    criteria: [{ text: "it works" }],
    funderKind: "human",
    funderId: "github:ada",
    createdAt: "2026-10-18T10:00:00.000Z",
  });
  await repo.create(bounty);
  const routes = readApiRoutes({ repo, activity, fundings: store, lightning });
  const post = (path: string, body?: unknown) =>
    routes.request(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  return { repo, bitnob, store, post };
}

describe("POST /api/bounties/:id/funding/simulate (sandbox pay)", () => {
  it("settles the open invoice and funds the bounty through the normal paid flow", async () => {
    const { repo, bitnob, post } = await setup(true);
    expect((await post(`/api/bounties/${ID}/funding`, { rail: "lightning" })).status).toBe(200);
    const res = await post(`/api/bounties/${ID}/funding/simulate`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "paid", bountyStatus: "funded" });
    expect(bitnob.simulated).toEqual(["inv-2"]);
    expect((await repo.findById(ID))?.status).toBe("funded");

    // Again: already paid, no second Bitnob call.
    const again = await post(`/api/bounties/${ID}/funding/simulate`);
    expect(await again.json()).toEqual({ status: "paid", bountyStatus: "funded" });
    expect(bitnob.simulated).toHaveLength(1);
  });

  it("refuses on production keys (or no sandbox gate) without calling Bitnob", async () => {
    for (const sandbox of [false, undefined]) {
      const { bitnob, post, repo } = await setup(sandbox);
      await post(`/api/bounties/${ID}/funding`, { rail: "lightning" });
      const res = await post(`/api/bounties/${ID}/funding/simulate`);
      expect(res.status).toBe(403);
      expect(bitnob.simulated).toEqual([]);
      expect((await repo.findById(ID))?.status).toBe("unfunded");
    }
  });

  it("409 when there is no pending invoice yet, 404 for an unknown bounty", async () => {
    const { bitnob, post } = await setup(true);
    expect((await post(`/api/bounties/${ID}/funding/simulate`)).status).toBe(409);
    expect((await post(`/api/bounties/nope/funding/simulate`)).status).toBe(404);
    expect(bitnob.simulated).toEqual([]);
  });
});
