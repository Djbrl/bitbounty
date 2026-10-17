import { SEED_IDS, createDb, repos, runMigrations, seed } from "@bitbounty/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleBountyRepo, placeholderGithubId, toUuid } from "./drizzle-repo.js";

const url = process.env.DATABASE_URL;
const REPO = "bitbounty-demo/bitnob-sdk";

it("maps readable submission ids to a stable uuid", () => {
  expect(toUuid("sub-a-1")).toBe(toUuid("sub-a-1"));
  expect(toUuid("sub-a-1")).not.toBe(toUuid("sub-a-2"));
  expect(toUuid("sub-a-1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(toUuid(SEED_IDS.repo)).toBe(SEED_IDS.repo);
});

it("placeholder GitHub ids are negative, stable and case-insensitive", () => {
  const id = placeholderGithubId("repo", "Djbrl/bitbounty");
  expect(id).toBeLessThan(0);
  expect(Number.isSafeInteger(id)).toBe(true);
  expect(placeholderGithubId("repo", "djbrl/BitBounty")).toBe(id);
  expect(placeholderGithubId("user", "Djbrl/bitbounty")).not.toBe(id);
});

// The demo seed read through the repo: rows written by other code map back to core types.
describe.skipIf(!url)("DrizzleBountyRepo on the demo seed (DATABASE_URL)", () => {
  const name = `bitbounty_test_repo_${process.pid}_${Date.now()}`;
  let admin: pg.Client;
  let conn: ReturnType<typeof createDb>;
  let repo: DrizzleBountyRepo;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database "${name}"`);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${name}`;
    conn = createDb(testUrl.toString());
    await runMigrations(conn.db);
    await seed(conn.db);
    repo = new DrizzleBountyRepo(conn.db);
  });

  afterAll(async () => {
    await conn?.close();
    await admin?.query(`drop database if exists "${name}"`);
    await admin?.end();
  });

  it("finds a seeded bounty by id and by issue, the human funder as github:<login>", async () => {
    const b = await repo.findById(SEED_IDS.bounty("claimed"));
    expect(b).toMatchObject({ status: "claimed", repoFullName: REPO, funderKind: "human" });
    expect(b?.funderId).toMatch(/^github:/);
    expect(await repo.findByIssue(REPO.toUpperCase(), b!.issueNumber)).toEqual(b);
    expect(await repo.findById("not-a-uuid")).toBeUndefined();
  });

  it("returns the seeded active claimant and the open bounties they hold", async () => {
    const id = SEED_IDS.bounty("claimed");
    expect(await repo.activeClaimant(id)).toMatchObject({ login: "awa-dev", userId: "github:awa-dev" });
    const open = await repo.openBountiesClaimedBy(REPO, "AWA-dev");
    expect(open.map((b) => b.id)).toContain(id);
    expect(open.every((b) => b.status === "claimed" || b.status === "submitted")).toBe(true);
  });

  it("creates on a known repo without adding a placeholder, and accepts a users.id funder", async () => {
    const before = (await conn.db.select().from(repos)).length;
    const seeded = (await repo.findById(SEED_IDS.bounty("claimed")))!;
    const res = await repo.create({
      ...seeded,
      id: "00000000-0000-4000-8000-0000000000aa",
      repoFullName: REPO.toUpperCase(),
      issueNumber: 900,
      status: "unfunded",
      funderId: SEED_IDS.maintainer,
    });
    expect(res.created).toBe(true);
    expect(res.bounty).toMatchObject({ repoFullName: REPO, funderId: "github:fatou-maintainer" });
    expect((await conn.db.select().from(repos)).length).toBe(before);
  });
});
