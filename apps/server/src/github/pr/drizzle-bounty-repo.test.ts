import { SEED_IDS, createDb, runMigrations, seed } from "@bitbounty/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleBountyRepo, toUuid } from "./drizzle-bounty-repo.js";

const url = process.env.DATABASE_URL;
const REPO = "bitbounty-demo/bitnob-sdk";

it("maps readable submission ids to a stable uuid", () => {
  expect(toUuid("sub-a-1")).toBe(toUuid("sub-a-1"));
  expect(toUuid("sub-a-1")).not.toBe(toUuid("sub-a-2"));
  expect(toUuid("sub-a-1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(toUuid(SEED_IDS.repo)).toBe(SEED_IDS.repo);
});

// Runs against the Postgres at DATABASE_URL, in a throwaway database (dev data untouched).
describe.skipIf(!url)("DrizzleBountyRepo on Postgres (DATABASE_URL)", () => {
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

  it("finds a bounty by id and by issue (repo name case-insensitive)", async () => {
    const b = await repo.findById(SEED_IDS.bounty("claimed"));
    expect(b).toMatchObject({ status: "claimed", repoFullName: REPO });
    expect(await repo.findByIssue(REPO.toUpperCase(), b!.issueNumber)).toEqual(b);
    expect(await repo.findById("not-a-uuid")).toBeUndefined();
  });

  it("returns the active claimant and the open bounties they hold", async () => {
    const id = SEED_IDS.bounty("claimed");
    expect(await repo.activeClaimant(id)).toMatchObject({ login: "awa-dev", userId: SEED_IDS.awa });
    const open = await repo.openBountiesClaimedBy(REPO, "AWA-dev");
    expect(open.map((b) => b.id)).toContain(id);
    expect(open.every((b) => b.status === "claimed" || b.status === "submitted")).toBe(true);
  });

  it("saves bounties and upserts submissions", async () => {
    const id = SEED_IDS.bounty("claimed");
    const b = (await repo.findById(id))!;
    await repo.saveBounty({ ...b, status: "submitted" });
    expect((await repo.findById(id))?.status).toBe("submitted");

    const sub = {
      id: `sub-${id}-321`,
      bountyId: id,
      prNumber: 321,
      authorLogin: "awa-dev",
      headSha: "abc123",
      verdict: null,
      report: null,
      spamScore: null,
      mergedAt: null,
    };
    await repo.saveSubmission(sub);
    const current = (await repo.currentSubmission(id))!;
    expect(current).toMatchObject({ prNumber: 321, headSha: "abc123" });
    await repo.saveSubmission({ ...current, mergedAt: "2026-10-17T20:00:00.000Z" });
    const forPr = await repo.submissionsForPr(REPO, 321);
    expect(forPr).toHaveLength(1);
    expect(forPr[0]?.mergedAt).toBe("2026-10-17T20:00:00.000Z");
  });
});
