import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  agents,
  bounties,
  bountyStatus,
  claims,
  events,
  fundings,
  installations,
  ledger,
  payoutAccounts,
  payouts,
  repos,
  submissions,
  users,
} from "./schema.js";

type BountyStatus = (typeof bountyStatus.enumValues)[number];
type NewBounty = typeof bounties.$inferInsert;
type NewFunding = typeof fundings.$inferInsert;
type NewClaim = typeof claims.$inferInsert;
type NewSubmission = typeof submissions.$inferInsert;
type NewPayout = typeof payouts.$inferInsert;
type NewLedger = typeof ledger.$inferInsert;
type NewEvent = typeof events.$inferInsert;

/** Stable ids so pages, fixtures and tests can link to seeded rows. */
export const seedId = (group: number, n: number) =>
  `00000000-0000-4000-8000-${String(group).padStart(4, "0")}${String(n).padStart(8, "0")}`;

export const SEED_IDS = {
  installation: seedId(1, 1),
  repo: seedId(2, 1),
  maintainer: seedId(3, 1),
  awa: seedId(3, 2),
  moussa: seedId(3, 3),
  agent: seedId(4, 1),
  bounty: (status: BountyStatus) => seedId(5, bountyStatus.enumValues.indexOf(status) + 1),
} as const;

const T0 = Date.parse("2026-10-17T15:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

const SATS_PER_XOF = 0.0017; // demo rate only, real rates come from Bitnob
const FEE_RATE = 0.05;

const TABLES = [
  "events",
  "ledger",
  "payouts",
  "submissions",
  "claims",
  "fundings",
  "bounties",
  "agents",
  "repos",
  "installations",
  "payout_accounts",
  "users",
] as const;

/** Empties every table. Used by the seed so it can run again and again. */
export async function resetDatabase(db: Database) {
  await db.execute(sql.raw(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`));
}

interface Story {
  issue: string;
  amountXof: number;
  funded: boolean;
  claim?: NewClaim["status"];
  submission?: { verdict: NonNullable<NewSubmission["verdict"]>; merged: boolean };
  payout?: { status: NonNullable<NewPayout["status"]>; attempts: number; lastError?: string };
  refunded?: boolean;
}

/** One bounty per status, each with the rows that status implies. */
const STORIES: Record<BountyStatus, Story> = {
  unfunded: { issue: "Add a French README", amountXof: 5_000, funded: false },
  funded: { issue: "Retry Lightning invoice polling on timeout", amountXof: 10_000, funded: true },
  claimed: {
    issue: "Validate Senegal phone numbers",
    amountXof: 7_500,
    funded: true,
    claim: "active",
  },
  submitted: {
    issue: "Translate error messages to Wolof",
    amountXof: 15_000,
    funded: true,
    claim: "active",
    submission: { verdict: "unsure", merged: false },
  },
  verified: {
    issue: "Fix XOF rounding in payout quotes",
    amountXof: 20_000,
    funded: true,
    claim: "done",
    submission: { verdict: "pass", merged: true },
  },
  paying: {
    issue: "Add idempotency keys to payouts",
    amountXof: 25_000,
    funded: true,
    claim: "done",
    submission: { verdict: "pass", merged: true },
    payout: { status: "processing", attempts: 1 },
  },
  paid: {
    issue: "Document the HMAC signature",
    amountXof: 10_000,
    funded: true,
    claim: "done",
    submission: { verdict: "pass", merged: true },
    payout: { status: "succeeded", attempts: 1 },
  },
  on_hold: {
    issue: "Handle expired Bitnob quotes",
    amountXof: 12_000,
    funded: true,
    claim: "done",
    submission: { verdict: "fail", merged: true },
  },
  payout_failed: {
    issue: "Support Orange Money in the onboarding form",
    amountXof: 8_000,
    funded: true,
    claim: "done",
    submission: { verdict: "pass", merged: true },
    payout: { status: "failed", attempts: 3, lastError: "withdrawal.expired: provider unavailable" },
  },
  refunded: {
    issue: "Benchmark the verifier",
    amountXof: 30_000,
    funded: true,
    refunded: true,
  },
  cancelled: { issue: "Dark mode for the board", amountXof: 5_000, funded: false },
};

/** Bounties still open to new work get the 60-day expiry (docs/product.md, edge cases). */
const OPEN: readonly BountyStatus[] = ["unfunded", "funded", "claimed"];

/**
 * Resets the database, then fills it with a demo repo, three users, an agent,
 * and one bounty in every status with consistent fundings, claims,
 * submissions, payouts, ledger lines and a timeline of events.
 * Runs in one transaction: on failure nothing changes.
 */
export async function seed(db: Database) {
  return db.transaction(async (tx) => insertSeed(tx as unknown as Database));
}

async function insertSeed(db: Database) {
  await resetDatabase(db);

  await db.insert(users).values([
    { id: SEED_IDS.maintainer, githubId: 1001, login: "fatou-maintainer", createdAt: at(-10_000) },
    { id: SEED_IDS.awa, githubId: 1002, login: "awa-dev", createdAt: at(-9_000) },
    { id: SEED_IDS.moussa, githubId: 1003, login: "moussa-dev", createdAt: at(-8_000) },
  ]);
  await db.insert(payoutAccounts).values([
    {
      userId: SEED_IDS.awa,
      country: "SN",
      provider: "wave",
      phoneE164: "+221770000001",
      accountName: "Awa Diop",
      status: "verified",
      testAmountXof: 137,
      verifiedAt: at(-8_500),
    },
    {
      userId: SEED_IDS.moussa,
      country: "SN",
      provider: "orange",
      phoneE164: "+221780000002",
      accountName: "Moussa Ndiaye",
      status: "verified",
      testAmountXof: 152,
      verifiedAt: at(-7_500),
    },
  ]);
  await db
    .insert(installations)
    .values({ id: SEED_IDS.installation, githubInstallationId: 5001, accountLogin: "bitbounty-demo" });
  await db.insert(repos).values({
    id: SEED_IDS.repo,
    installationId: SEED_IDS.installation,
    githubRepoId: 7001,
    fullName: "bitbounty-demo/bitnob-sdk",
  });
  await db.insert(agents).values({
    id: SEED_IDS.agent,
    ownerUserId: SEED_IDS.maintainer,
    name: "demo-agent",
    keyHash: "sha256:demo-agent-key-hash",
    monthlyBudgetXof: 100_000,
    perTaskMaxXof: 20_000,
    allowedRepos: ["bitbounty-demo/bitnob-sdk"],
  });

  const bountyRows: NewBounty[] = [];
  const fundingRows: NewFunding[] = [];
  const claimRows: NewClaim[] = [];
  const submissionRows: NewSubmission[] = [];
  const payoutRows: NewPayout[] = [];
  const ledgerRows: NewLedger[] = [];
  const eventRows: NewEvent[] = [];

  bountyStatus.enumValues.forEach((status, i) => {
    const story = STORIES[status];
    const n = i + 1;
    const id = SEED_IDS.bounty(status);
    const byAgent = status === "submitted"; // the agent-funded Wolof task
    const dev = status === "payout_failed" ? SEED_IDS.moussa : SEED_IDS.awa;
    const devLogin = status === "payout_failed" ? "moussa-dev" : "awa-dev";
    const verdict = story.submission?.verdict ?? null;
    const event = (type: string, minutes: number, payload: Record<string, unknown> = {}) =>
      eventRows.push({
        bountyId: id,
        source: "system",
        externalId: `seed-${n}-${type}`,
        type,
        payload: { bountyId: id, ...payload },
        status: "processed",
        receivedAt: at(n + minutes),
      });
    event("bounty.created", 0, { amountXof: story.amountXof });

    bountyRows.push({
      id,
      repoId: SEED_IDS.repo,
      issueNumber: n,
      issueTitle: story.issue,
      amountXof: story.amountXof,
      status,
      criteria: [{ text: "The change is covered by a test" }, { text: "CI is green" }],
      funderKind: byAgent ? "agent" : "human",
      funderId: byAgent ? SEED_IDS.agent : SEED_IDS.maintainer,
      verdict,
      statusCommentId: 9_000 + n,
      createdAt: at(n),
      expiresAt: OPEN.includes(status) ? at(n + 60 * 24 * 60) : null,
    });

    const totalXof = Math.round(story.amountXof * (1 + FEE_RATE));
    fundingRows.push({
      id: seedId(6, n),
      bountyId: id,
      rail: status === "refunded" ? "ngn" : "lightning",
      sourceAmount:
        status === "refunded" ? totalXof * 270 /* kobo, demo rate */ : Math.round(totalXof * SATS_PER_XOF * 1_000),
      sourceCurrency: status === "refunded" ? "NGN" : "BTC",
      bitnobRef: `fund-${id}-1`,
      paymentHash: status === "refunded" ? null : `hash-${n}`,
      status: story.funded ? "paid" : status === "cancelled" ? "expired" : "pending",
      createdAt: at(n + 1),
      paidAt: story.funded ? at(n + 5) : null,
    });

    if (story.funded) {
      const fee = totalXof - story.amountXof;
      ledgerRows.push(
        { bountyId: id, kind: "fund", amount: totalXof, currency: "XOF", ref: `fund-${id}-1`, createdAt: at(n + 5) },
        { bountyId: id, kind: "fee", amount: -fee, currency: "XOF", ref: `fund-${id}-1`, createdAt: at(n + 5) },
      );
      event("funding.paid", 5, { rail: status === "refunded" ? "ngn" : "lightning" });
    }
    if (story.refunded) {
      ledgerRows.push({
        bountyId: id,
        kind: "refund",
        amount: -story.amountXof,
        currency: "XOF",
        ref: `refund-${id}`,
        createdAt: at(n + 60),
      });
      event("bounty.refunded", 60);
    }
    if (status === "cancelled") event("bounty.cancelled", 20);

    if (story.claim) {
      claimRows.push({
        id: seedId(7, n),
        bountyId: id,
        userId: dev,
        status: story.claim,
        createdAt: at(n + 10),
        expiresAt: at(n + 10 + 72 * 60),
      });
      event("claim.created", 10, { login: devLogin });
    }

    if (story.submission) {
      submissionRows.push({
        id: seedId(8, n),
        bountyId: id,
        prNumber: 100 + n,
        authorLogin: devLogin,
        headSha: `sha${String(n).padStart(37, "0")}`,
        verdict: story.submission.verdict,
        report: {
          criteria: [
            { text: "The change is covered by a test", met: story.submission.verdict === "pass", evidence: "test/payout.test.ts:12" },
            { text: "CI is green", met: story.submission.verdict !== "fail", evidence: "CI run passed" },
          ],
          verdict: story.submission.verdict,
          summary: `Seeded verifier report for issue #${n}.`,
          riskFlags: story.submission.verdict === "fail" ? ["touches unrelated files"] : [],
        },
        spamScore: 0.05,
        createdAt: at(n + 30),
        mergedAt: story.submission.merged ? at(n + 45) : null,
      });
      event("pr.linked", 30, { prNumber: 100 + n });
      event("verify.done", 35, { verdict: story.submission.verdict });
      if (story.submission.merged) event("pr.merged", 45, { prNumber: 100 + n });
      if (status === "on_hold") event("bounty.on_hold", 46, { reason: "verifier said fail" });
    }

    if (story.payout) {
      const succeeded = story.payout.status === "succeeded";
      payoutRows.push({
        id: seedId(9, n),
        bountyId: id,
        userId: dev,
        amountXof: story.amountXof,
        quoteId: `quote-${n}`,
        bitnobPayoutId: story.payout.status === "pending" ? null : `PAYOUT_${n}`,
        reference: `pay-${id}`,
        status: story.payout.status,
        attempts: story.payout.attempts,
        lastError: story.payout.lastError ?? null,
        createdAt: at(n + 46),
        paidAt: succeeded ? at(n + 51) : null,
      });
      if (story.payout.status === "failed") event("payout.failed", 50, { error: story.payout.lastError });
      if (succeeded) {
        event("payout.succeeded", 51, { reference: `pay-${id}` });
        ledgerRows.push({
          bountyId: id,
          kind: "payout",
          amount: -story.amountXof,
          currency: "XOF",
          ref: `pay-${id}`,
          createdAt: at(n + 51),
        });
      }
    }
  });

  await db.insert(bounties).values(bountyRows);
  await db.insert(fundings).values(fundingRows);
  if (claimRows.length) await db.insert(claims).values(claimRows);
  if (submissionRows.length) await db.insert(submissions).values(submissionRows);
  if (payoutRows.length) await db.insert(payouts).values(payoutRows);
  await db.insert(ledger).values(ledgerRows);
  await db.insert(events).values([
    ...eventRows,
    {
      bountyId: SEED_IDS.bounty("funded"),
      source: "github",
      externalId: "delivery-seed-1",
      type: "issue_comment",
      action: "created",
      repo: "bitbounty-demo/bitnob-sdk",
      payload: { body: "/bounty 10000", issue: 2 },
      status: "processed",
      receivedAt: at(2),
    },
    {
      bountyId: SEED_IDS.bounty("paid"),
      source: "bitnob",
      externalId: "payout-seed-7",
      type: "payouts.withdrawal.success",
      payload: { reference: `pay-${SEED_IDS.bounty("paid")}` },
      status: "processed",
      receivedAt: at(58),
    },
  ]);

  return {
    users: 3,
    bounties: bountyRows.length,
    fundings: fundingRows.length,
    claims: claimRows.length,
    submissions: submissionRows.length,
    payouts: payoutRows.length,
    ledger: ledgerRows.length,
    events: eventRows.length + 2,
  };
}
