import { createHash } from "node:crypto";
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

/**
 * Stable ids so pages, fixtures and tests can link to seeded rows. Every seeded uuid starts with
 * `00000000-0000-4000-8000-`: that prefix is how the seed finds (and replaces) its own rows
 * without touching anything else in the database.
 */
export const seedId = (group: number, n: number) =>
  `00000000-0000-4000-8000-${String(group).padStart(4, "0")}${String(n).padStart(8, "0")}`;
const SEED_PREFIX = "00000000-0000-4000-8000-%";

// --- the demo story -------------------------------------------------------------------------

/** People. `maintainer` is the real owner of the demo repos, so his dashboard shows them. */
const PEOPLE = {
  maintainer: { n: 1, login: "Djbrl" },
  awa: { n: 2, login: "awa-diop", lightningAddress: "awadiop@blink.sv", phone: "+221770000001", name: "Awa Diop", provider: "wave" },
  moussa: { n: 3, login: "moussa-ndiaye", lightningAddress: "moussa@walletofsatoshi.com", phone: "+221780000002", name: "Moussa Ndiaye", provider: "orange" },
  fatou: { n: 4, login: "fatou-sall", lightningAddress: "fatousall@blink.sv", phone: "+221760000003", name: "Fatou Sall", provider: "wave" },
  /** A funder in Lagos who pays in naira. */
  chidi: { n: 5, login: "chidi-okafor" },
} as const;
type Person = keyof typeof PEOPLE;
type Developer = "awa" | "moussa" | "fatou";

const REPOS = {
  wallet: { n: 1, fullName: "Djbrl/sunu-wallet" },
  ui: { n: 2, fullName: "Djbrl/teranga-ui" },
  rates: { n: 3, fullName: "Djbrl/xof-rates" },
} as const;
type RepoKey = keyof typeof REPOS;

interface Story {
  repo: RepoKey;
  issue: number;
  title: string;
  amountXof: number;
  status: Extract<BountyStatus, "unfunded" | "funded" | "claimed" | "submitted" | "verified" | "paid">;
  criteria: string[];
  /** Who pays: a person, or the maintainer's agent (A4). */
  funder: Person | "agent";
  rail?: "lightning" | "ngn";
  dev?: Developer;
  verdict?: "pass" | "unsure";
  summary?: string;
  /** Minutes from merge to paid, for paid bounties. */
  mergeToPayMin?: number;
}

/** 9 bounties on 3 repos, a mix of statuses, no failure on the board. */
const STORIES: Story[] = [
  {
    repo: "wallet",
    issue: 7,
    title: "Fix the flaky invoice-expiry test on slow CI",
    amountXof: 10_000,
    status: "paid",
    criteria: ["`invoice-expiry.test.ts` passes 50 runs in a row with `--repeat 50`", "No real timers: the test uses fake timers", "CI is green"],
    funder: "agent",
    dev: "awa",
    verdict: "pass",
    summary: "Replaces the 2 s sleep with vi.useFakeTimers(); 50/50 runs pass. CI green.",
    mergeToPayMin: 2,
  },
  {
    repo: "ui",
    issue: 3,
    title: "Visible focus ring and aria-labels on Button and Modal",
    amountXof: 8_000,
    status: "paid",
    criteria: ["Keyboard focus is visible on every Button variant (3:1 contrast)", "Icon-only buttons and the Modal close button have an aria-label", "axe reports no new violation on the Storybook pages"],
    funder: "maintainer",
    dev: "moussa",
    verdict: "pass",
    summary: "Adds a :focus-visible ring using the theme accent and aria-labels on icon buttons; axe clean.",
    mergeToPayMin: 3,
  },
  {
    repo: "rates",
    issue: 2,
    title: "Rate-limit /v1/convert per API key",
    amountXof: 25_000,
    status: "paid",
    criteria: ["60 requests per minute per key, then 429 with a Retry-After header", "Limits are per key, not per IP", "Covered by a test"],
    funder: "maintainer",
    dev: "fatou",
    verdict: "pass",
    summary: "Token bucket per API key in Redis, 429 + Retry-After, tests for burst and refill.",
    mergeToPayMin: 2,
  },
  {
    repo: "ui",
    issue: 5,
    title: "Docs: theming guide (colors, dark mode)",
    amountXof: 5_000,
    status: "verified",
    criteria: ["A `docs/theming.md` page with the color tokens and a dark mode example", "Linked from the README"],
    funder: "maintainer",
    dev: "awa",
    verdict: "pass",
    summary: "New docs/theming.md with the token table and a dark mode snippet, linked from the README.",
  },
  {
    repo: "wallet",
    issue: 4,
    title: "Translate the onboarding screens to Wolof",
    amountXof: 15_000,
    status: "submitted",
    criteria: ["Every string of the 3 onboarding screens has a Wolof (`wo`) translation", "The language picker lists Wolof", "A native speaker approves the wording in the PR"],
    funder: "maintainer",
    dev: "fatou",
    verdict: "unsure",
    summary: "All 3 screens translated and Wolof added to the picker; wording needs a native speaker's review.",
  },
  {
    repo: "wallet",
    issue: 9,
    title: "Show amounts in sats and FCFA on the receive screen",
    amountXof: 12_500,
    status: "claimed",
    criteria: ["The receive screen shows the amount in sats with the FCFA value under it", "The rate refreshes every 60 s", "Covered by a test"],
    funder: "maintainer",
    dev: "moussa",
  },
  {
    repo: "rates",
    issue: 6,
    title: "Add the NGN ↔ XOF pair",
    amountXof: 18_000,
    status: "funded",
    criteria: ["`/v1/convert?from=NGN&to=XOF` and the reverse return a rate", "The rate source and time are in the response", "Covered by a test"],
    funder: "chidi",
    rail: "ngn",
  },
  {
    repo: "ui",
    issue: 8,
    title: "Respect prefers-reduced-motion in Toast and Modal",
    amountXof: 7_500,
    status: "funded",
    criteria: ["No slide or fade animation when the OS asks for reduced motion", "Covered by a test"],
    funder: "maintainer",
  },
  {
    repo: "wallet",
    issue: 11,
    title: "Scan Lightning Address QR codes",
    amountXof: 20_000,
    status: "unfunded",
    criteria: ["The send screen scans a QR code holding a Lightning Address or an LNURL", "A clear error for anything else"],
    funder: "maintainer",
  },
];

export const SEED_IDS = {
  installation: seedId(1, 1),
  repo: seedId(2, REPOS.wallet.n),
  repos: { wallet: seedId(2, REPOS.wallet.n), ui: seedId(2, REPOS.ui.n), rates: seedId(2, REPOS.rates.n) },
  maintainer: seedId(3, PEOPLE.maintainer.n),
  awa: seedId(3, PEOPLE.awa.n),
  moussa: seedId(3, PEOPLE.moussa.n),
  fatou: seedId(3, PEOPLE.fatou.n),
  chidi: seedId(3, PEOPLE.chidi.n),
  agent: seedId(4, 1),
  /** The first seeded bounty in that status (throws if the seed has none). */
  bounty: (status: BountyStatus) => {
    const i = STORIES.findIndex((s) => s.status === status);
    if (i < 0) throw new Error(`the seed has no ${status} bounty`);
    return seedId(5, i + 1);
  },
  /** Every seeded bounty, in story order. */
  bounties: STORIES.map((_, i) => seedId(5, i + 1)),
} as const;

/** Demo rates only; real ones come from Bitnob. */
export const SEED_XOF_PER_BTC = 62_000_000;
const KOBO_PER_XOF = 260; // 1 FCFA ≈ 2.60 NGN
const FEE_RATE = 0.05;
const sats = (xof: number) => Math.round((xof * 100_000_000) / SEED_XOF_PER_BTC);
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** Every table, children first. */
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

/** Empties every table. Not used by the seed any more (it only replaces its own rows); kept for tests and local resets. */
export async function resetDatabase(db: Database) {
  await db.execute(sql.raw(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`));
}

/**
 * Removes every row an earlier seed wrote (any version: they all use the `seedId` prefix), and
 * nothing else. Seeded users, repos, installations and agents that real rows now point at are kept.
 */
export async function removeSeedRows(db: Database) {
  const p = SEED_PREFIX;
  for (const table of ["events", "ledger", "payouts", "submissions", "claims", "fundings"]) {
    await db.execute(sql.raw(`delete from "${table}" where bounty_id::text like '${p}'`));
  }
  await db.execute(sql.raw(`delete from events where source = 'system' and external_id like 'seed-%'`));
  await db.execute(sql.raw(`delete from bounties where id::text like '${p}'`));
  await db.execute(
    sql.raw(`delete from agents a where a.id::text like '${p}' and not exists (select 1 from bounties b where b.funder_id = a.id)`),
  );
  await db.execute(sql.raw(`delete from payout_accounts where user_id::text like '${p}'`));
  await db.execute(
    sql.raw(`delete from users u where u.id::text like '${p}'
      and not exists (select 1 from claims c where c.user_id = u.id)
      and not exists (select 1 from payouts x where x.user_id = u.id)
      and not exists (select 1 from agents a where a.owner_user_id = u.id)
      and not exists (select 1 from bounties b where b.funder_id = u.id)`),
  );
  await db.execute(
    sql.raw(`delete from repos r where r.id::text like '${p}' and not exists (select 1 from bounties b where b.repo_id = r.id)`),
  );
  await db.execute(
    sql.raw(`delete from installations i where i.id::text like '${p}' and not exists (select 1 from repos r where r.installation_id = i.id)`),
  );
}

export interface SeedOptions {
  /** End of the story (the last payout is a few minutes before). Default: now. */
  now?: Date;
}

/**
 * Replaces the demo rows: 3 repos owned by Djbrl, 4 people with Lightning Addresses or a naira
 * account, an agent, and 9 bounties (open, funded, claimed, submitted, verified, 3 paid) with
 * the fundings, claims, submissions, payouts, ledger lines and events each status implies.
 *
 * Re-runnable and non-destructive: it removes only rows an earlier seed wrote (fixed ids), so
 * real bounties, webhooks and users created by the live server survive a reseed. Runs in one
 * transaction: on failure nothing changes.
 */
export async function seed(db: Database, opts: SeedOptions = {}) {
  return db.transaction(async (tx) => insertSeed(tx as unknown as Database, opts));
}

async function rowsOf<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}

/** Reuses a user the server already knows by login (case-insensitive), or inserts the seeded one. */
async function ensureUser(db: Database, login: string, id: string, githubId: number, createdAt: Date) {
  const [found] = await rowsOf<{ id: string }>(db, sql`select id from users where lower(login) = lower(${login}) limit 1`);
  if (found) return found.id;
  await db.insert(users).values({ id, githubId, login, createdAt });
  return id;
}

async function insertSeed(db: Database, opts: SeedOptions) {
  // Story clock: everything happens in the 2 days before `now`, rounded to the minute.
  const end = Math.floor((opts.now ?? new Date()).getTime() / 60_000) * 60_000;
  const T0 = end - 48 * 60 * 60_000;
  const at = (minutes: number) => new Date(T0 + minutes * 60_000);

  await removeSeedRows(db);

  // People. Seeded GitHub ids are far above real ones so they never collide.
  const userId = {} as Record<Person, string>;
  for (const [key, person] of Object.entries(PEOPLE) as [Person, (typeof PEOPLE)[Person]][]) {
    userId[key] = await ensureUser(db, person.login, seedId(3, person.n), 9_900_000_000 + person.n, at(-30 * 24 * 60 + person.n));
  }
  const developers: Developer[] = ["awa", "moussa", "fatou"];
  for (const d of developers) {
    const p = PEOPLE[d];
    // Until B6's Lightning columns exist, an account needs a phone: the Lightning Address is set below when they do.
    const account = {
      userId: userId[d],
      country: "SN",
      provider: p.provider,
      phoneE164: p.phone,
      accountName: p.name,
      status: "verified" as const,
      testAmountXof: 150 + p.n,
      verifiedAt: at(-20 * 24 * 60 + p.n),
    };
    await db.insert(payoutAccounts).values(account).onConflictDoUpdate({ target: payoutAccounts.userId, set: account });
  }

  // The GitHub side: reuse Djbrl's installation if the server already stored it.
  const [inst] = await rowsOf<{ id: string }>(db, sql`select id from installations where lower(account_login) = 'djbrl' limit 1`);
  let installationId = inst?.id;
  if (!installationId) {
    installationId = SEED_IDS.installation;
    await db.insert(installations).values({ id: installationId, githubInstallationId: 9_900_000_101, accountLogin: "Djbrl", createdAt: at(-30 * 24 * 60) });
  }
  const repoId = {} as Record<RepoKey, string>;
  for (const [key, r] of Object.entries(REPOS) as [RepoKey, (typeof REPOS)[RepoKey]][]) {
    const row = { id: seedId(2, r.n), installationId, githubRepoId: 9_900_000_200 + r.n, fullName: r.fullName, createdAt: at(-30 * 24 * 60) };
    await db.insert(repos).values(row).onConflictDoUpdate({ target: repos.id, set: { installationId, fullName: r.fullName } });
    repoId[key] = row.id;
  }

  const agent = {
    id: SEED_IDS.agent,
    ownerUserId: userId.maintainer,
    name: "ci-triage-agent",
    keyHash: "sha256:seed-ci-triage-agent",
    monthlyBudgetXof: 100_000,
    perTaskMaxXof: 20_000,
    allowedRepos: [REPOS.wallet.fullName, REPOS.ui.fullName],
    createdAt: at(-10 * 24 * 60),
  };
  await db.insert(agents).values(agent).onConflictDoUpdate({ target: agents.id, set: agent });

  const bountyRows: NewBounty[] = [];
  const fundingRows: NewFunding[] = [];
  const claimRows: NewClaim[] = [];
  const submissionRows: NewSubmission[] = [];
  const payoutRows: NewPayout[] = [];
  const lightningPayouts: { id: string; address: string; amountSats: number; paymentHash: string; preimage: string; sentAt: Date }[] = [];
  const ledgerRows: NewLedger[] = [];
  const eventRows: NewEvent[] = [];

  const ORDER = ["unfunded", "funded", "claimed", "submitted", "verified", "paid"] as const;
  STORIES.forEach((story, i) => {
    const n = i + 1;
    const id = seedId(5, n);
    const repoName = REPOS[story.repo].fullName;
    const stage = ORDER.indexOf(story.status);
    // Stories start 4 h apart: the paid ones ~45 h ago, the open one ~15 h ago.
    const start = n * 4 * 60 - 3 * 60;
    const t = (m: number) => at(start + m);
    const event = (type: string, m: number, payload: Record<string, unknown> = {}) =>
      eventRows.push({ bountyId: id, source: "system", externalId: `seed-${n}-${type}`, type, repo: repoName, payload: { bountyId: id, ...payload }, status: "processed", receivedAt: t(m), processedAt: t(m) });

    const byAgent = story.funder === "agent";
    bountyRows.push({
      id,
      repoId: repoId[story.repo],
      issueNumber: story.issue,
      issueTitle: story.title,
      amountXof: story.amountXof,
      status: story.status,
      criteria: story.criteria.map((text) => ({ text })),
      funderKind: byAgent ? "agent" : "human",
      funderId: byAgent ? SEED_IDS.agent : userId[story.funder as Person],
      verdict: story.verdict ?? null,
      statusCommentId: 9_900_000_000 + n,
      createdAt: t(0),
      expiresAt: stage <= 2 ? at(start + 60 * 24 * 60) : null,
    });
    event("bounty.created", 0, { amountXof: story.amountXof, funderKind: byAgent ? "agent" : "human" });

    // Funding: the developer gets amountXof, the funder pays it plus the 5% fee.
    const totalXof = Math.round(story.amountXof * (1 + FEE_RATE));
    const ngn = story.rail === "ngn";
    const fundRef = `fund-${id}-1`;
    const funded = stage >= 1;
    fundingRows.push({
      id: seedId(6, n),
      bountyId: id,
      rail: ngn ? "ngn" : "lightning",
      sourceAmount: ngn ? totalXof * KOBO_PER_XOF : sats(totalXof),
      sourceCurrency: ngn ? "NGN" : "BTC",
      bitnobRef: fundRef,
      paymentHash: ngn ? null : sha256(Buffer.from(sha256(`seed-funding-preimage:${id}`), "hex")),
      status: funded ? "paid" : "pending",
      createdAt: t(2),
      paidAt: funded ? t(4) : null,
    });
    if (funded) {
      ledgerRows.push(
        { bountyId: id, kind: "fund", amount: totalXof, currency: "XOF", ref: fundRef, createdAt: t(4) },
        { bountyId: id, kind: "fee", amount: -(totalXof - story.amountXof), currency: "XOF", ref: fundRef, createdAt: t(4) },
      );
      event("funding.paid", 4, ngn ? { rail: "ngn", amountNgn: (totalXof * KOBO_PER_XOF) / 100, from: "Lagos" } : { rail: "lightning", amountSats: sats(totalXof) });
    }

    if (!story.dev || stage < 2) return;
    const dev = story.dev;
    const devLogin = PEOPLE[dev].login;
    claimRows.push({
      id: seedId(7, n),
      bountyId: id,
      userId: userId[dev],
      status: stage === 2 || stage === 3 ? "active" : "done",
      createdAt: t(20),
      expiresAt: t(20 + 72 * 60),
    });
    event("claim.created", 20, { login: devLogin });
    if (stage < 3) return;

    const verdict = story.verdict ?? "pass";
    const merged = stage >= 4;
    const prNumber = story.issue + 10 + n;
    submissionRows.push({
      id: seedId(8, n),
      bountyId: id,
      prNumber,
      authorLogin: devLogin,
      headSha: sha256(`seed-head:${id}`).slice(0, 40),
      verdict,
      report: {
        criteria: story.criteria.map((text, k) => ({
          text,
          met: verdict === "pass" || k < story.criteria.length - 1,
          evidence: verdict === "pass" || k < story.criteria.length - 1 ? `PR #${prNumber}, checked by the verifier` : "needs a human: the verifier cannot judge Wolof wording",
        })),
        verdict,
        summary: story.summary ?? "",
        riskFlags: [],
      },
      spamScore: 0.02,
      createdAt: t(180),
      mergedAt: merged ? t(240) : null,
    });
    event("pr.linked", 180, { prNumber });
    event("verify.done", 185, { verdict });
    if (!merged) return;
    event("pr.merged", 240, { prNumber });
    if (stage < 5) return;

    // Paid in sats over Lightning to the developer's Lightning Address.
    const paidAt = t(240 + (story.mergeToPayMin ?? 2));
    const preimage = sha256(`seed-payout-preimage:${id}`);
    const paymentHash = sha256(Buffer.from(preimage, "hex"));
    const reference = `pay-${id}`;
    const payoutId = seedId(9, n);
    payoutRows.push({
      id: payoutId,
      bountyId: id,
      userId: userId[dev],
      amountXof: story.amountXof,
      quoteId: null,
      bitnobPayoutId: `ln_${paymentHash.slice(0, 24)}`,
      reference,
      status: "succeeded",
      attempts: 1,
      lastError: null,
      createdAt: t(241),
      paidAt,
    });
    lightningPayouts.push({ id: payoutId, address: PEOPLE[dev].lightningAddress, amountSats: sats(story.amountXof), paymentHash, preimage, sentAt: t(241) });
    ledgerRows.push({ bountyId: id, kind: "payout", amount: -story.amountXof, currency: "XOF", ref: reference, createdAt: paidAt });
    event("payout.sent", 241, { reference, rail: "lightning", amountSats: sats(story.amountXof) });
    event("payout.succeeded", 240 + (story.mergeToPayMin ?? 2), { reference, rail: "lightning", amountSats: sats(story.amountXof), paymentHash });
  });

  await db.insert(bounties).values(bountyRows);
  await db.insert(fundings).values(fundingRows);
  await db.insert(claims).values(claimRows);
  await db.insert(submissions).values(submissionRows);
  await db.insert(payouts).values(payoutRows);
  await db.insert(ledger).values(ledgerRows);
  await db.insert(events).values(eventRows);

  // B6 (Lightning payouts) adds Lightning columns. When this database has them, fill them so the
  // accounts are Lightning-only and the receipts show sats. Without them, this step is skipped.
  const cols = await rowsOf<{ table_name: string; column_name: string }>(
    db,
    sql`select table_name, column_name from information_schema.columns where table_schema = current_schema()
        and ((table_name = 'payout_accounts' and column_name = 'lightning_address') or (table_name = 'payouts' and column_name = 'amount_sats'))`,
  );
  const has = (table: string) => cols.some((c) => c.table_name === table);
  if (has("payout_accounts")) {
    for (const d of developers) {
      await db.execute(
        sql`update payout_accounts set lightning_address = ${PEOPLE[d].lightningAddress}, provider = null, phone_e164 = null, account_name = null where user_id = ${userId[d]}`,
      );
    }
  }
  if (has("payouts")) {
    for (const p of lightningPayouts) {
      await db.execute(
        sql`update payouts set rail = 'lightning', lightning_address = ${p.address}, amount_sats = ${p.amountSats}, xof_per_btc = ${SEED_XOF_PER_BTC},
            payment_hash = ${p.paymentHash}, preimage = ${p.preimage}, sent_at = ${p.sentAt.toISOString()} where id = ${p.id}`,
      );
    }
  }

  return {
    users: Object.keys(PEOPLE).length,
    repos: Object.keys(REPOS).length,
    bounties: bountyRows.length,
    fundings: fundingRows.length,
    claims: claimRows.length,
    submissions: submissionRows.length,
    payouts: payoutRows.length,
    ledger: ledgerRows.length,
    events: eventRows.length,
    lightningColumns: has("payout_accounts") && has("payouts"),
  };
}
