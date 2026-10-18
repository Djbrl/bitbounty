import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Tables from docs/plan.md §3. Enum values mirror `@bitbounty/core` (types.ts):
 * keep them in sync, they can only grow. Money is always an integer of the
 * smallest unit (whole FCFA, sats, kobo, USDT base units), never a float.
 *
 * Ledger convention: every line is signed from the bounty's escrow point of
 * view, so the sum of a bounty's lines is the money still held for it.
 *   fund +total paid by the funder · fee -BitBounty's cut · payout -amount sent
 *   · refund -amount returned. A funded bounty sums to amountXof, a paid or
 *   refunded one to 0. `reserve` and `fx` are internal moves: they come in
 *   pairs that net to zero.
 */

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// --- enums (mirror @bitbounty/core) ---

export const bountyStatus = pgEnum("bounty_status", [
  "unfunded",
  "funded",
  "claimed",
  "submitted",
  "verified",
  "paying",
  "paid",
  "on_hold",
  "payout_failed",
  "refunded",
  "cancelled",
]);
export const funderKind = pgEnum("funder_kind", ["human", "agent"]);
export const fundingRail = pgEnum("funding_rail", ["lightning", "usdt", "ngn"]);
export const fundingStatus = pgEnum("funding_status", ["pending", "paid", "expired"]);
export const sourceCurrency = pgEnum("source_currency", ["BTC", "USDT", "NGN"]);
export const currency = pgEnum("currency", ["XOF", "BTC", "USDT", "NGN"]);
export const claimStatus = pgEnum("claim_status", ["active", "released", "expired", "done"]);
export const verdict = pgEnum("verdict", ["pass", "fail", "unsure"]);
export const payoutStatus = pgEnum("payout_status", ["pending", "processing", "succeeded", "failed"]);
export const payoutProvider = pgEnum("payout_provider", ["wave", "orange", "free"]);
/** B6: how a payout is sent. Rows from before B6 are mobile money. */
export const payoutRail = pgEnum("payout_rail", ["mobile_money", "lightning"]);
export const payoutAccountStatus = pgEnum("payout_account_status", ["pending", "sms_ok", "verified"]);
export const ledgerKind = pgEnum("ledger_kind", ["fund", "fee", "reserve", "payout", "refund", "fx"]);
export const eventSource = pgEnum("event_source", ["github", "bitnob", "system"]);
export const eventStatus = pgEnum("event_status", ["received", "processed", "failed"]);

// --- people ---

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  login: text("login").notNull().unique(),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

export const payoutAccounts = pgTable(
  "payout_accounts",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** B6: where payouts go (Lightning Address, LUD-16). The mobile money columns are the legacy B3 rail. */
    lightningAddress: text("lightning_address"),
    country: text("country").notNull(),
    provider: payoutProvider("provider"),
    phoneE164: text("phone_e164"),
    accountName: text("account_name"),
    status: payoutAccountStatus("status").notNull().default("pending"),
    testAmountXof: integer("test_amount_xof"),
    verifiedAt: ts("verified_at"),
    lockedUntil: ts("locked_until"),
  },
  (t) => [
    // 1 number = 1 GitHub account (docs/product.md, flow 3).
    uniqueIndex("payout_accounts_phone_idx").on(t.phoneE164),
    check("payout_accounts_phone_e164", sql`${t.phoneE164} ~ '^[+][1-9][0-9]{7,14}$'`),
    check("payout_accounts_test_amount", sql`${t.testAmountXof} between 100 and 199`),
    // Somewhere to pay: a Lightning Address (B6), or the legacy mobile money number.
    check("payout_accounts_destination", sql`${t.lightningAddress} is not null or ${t.phoneE164} is not null`),
    check(
      "payout_accounts_lightning_address",
      sql`${t.lightningAddress} ~ '^[a-z0-9._+-]{1,64}@([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,63}$'`,
    ),
  ],
);

// --- GitHub ---

export const installations = pgTable("installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubInstallationId: bigint("github_installation_id", { mode: "number" }).notNull().unique(),
  accountLogin: text("account_login").notNull(),
  createdAt: createdAt(),
});

export const repos = pgTable("repos", {
  id: uuid("id").primaryKey().defaultRandom(),
  installationId: uuid("installation_id")
    .notNull()
    .references(() => installations.id, { onDelete: "cascade" }),
  /** Stable across renames and transfers; webhooks carry it. */
  githubRepoId: bigint("github_repo_id", { mode: "number" }).notNull().unique(),
  fullName: text("full_name").notNull().unique(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

// --- bounties ---

export const bounties = pgTable(
  "bounties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id),
    issueNumber: integer("issue_number").notNull(),
    issueTitle: text("issue_title").notNull(),
    /** What the developer receives, in whole FCFA. */
    amountXof: integer("amount_xof").notNull(),
    /** Written only through `transition()` in @bitbounty/core. */
    status: bountyStatus("status").notNull().default("unfunded"),
    criteria: jsonb("criteria").$type<{ text: string }[]>().notNull().default([]),
    funderKind: funderKind("funder_kind").notNull(),
    /** `users.id` when funderKind is human, `agents.id` when agent (no FK: it points at either). */
    funderId: uuid("funder_id").notNull(),
    verdict: verdict("verdict"),
    statusCommentId: bigint("status_comment_id", { mode: "number" }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at"),
  },
  (t) => [
    uniqueIndex("bounties_repo_issue_idx").on(t.repoId, t.issueNumber),
    index("bounties_status_idx").on(t.status),
    check("bounties_amount_positive", sql`${t.amountXof} > 0`),
  ],
);

export const fundings = pgTable(
  "fundings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id),
    rail: fundingRail("rail").notNull(),
    /** Integer in the rail's smallest unit: sats, USDT base units, or kobo. */
    sourceAmount: bigint("source_amount", { mode: "number" }).notNull(),
    sourceCurrency: sourceCurrency("source_currency").notNull(),
    bitnobRef: text("bitnob_ref").notNull().unique(),
    paymentHash: text("payment_hash"),
    status: fundingStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
    paidAt: ts("paid_at"),
  },
  (t) => [
    index("fundings_bounty_idx").on(t.bountyId),
    check("fundings_amount_positive", sql`${t.sourceAmount} > 0`),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: claimStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    /** How many times `/extend` pushed `expires_at` back (G5). */
    extensions: integer("extensions").notNull().default(0),
  },
  (t) => [
    index("claims_bounty_idx").on(t.bountyId),
    index("claims_user_idx").on(t.userId),
    // One active claim per issue (docs/product.md, flow 4): two /claim at once can't both win.
    uniqueIndex("claims_one_active_idx").on(t.bountyId).where(sql`${t.status} = 'active'`),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id),
    prNumber: integer("pr_number").notNull(),
    authorLogin: text("author_login").notNull(),
    headSha: text("head_sha").notNull(),
    verdict: verdict("verdict"),
    report: jsonb("report").$type<{
      criteria: { text: string; met: boolean; evidence: string }[];
      verdict: "pass" | "fail" | "unsure";
      summary: string;
      riskFlags: string[];
    }>(),
    spamScore: real("spam_score"),
    createdAt: createdAt(),
    mergedAt: ts("merged_at"),
  },
  (t) => [
    uniqueIndex("submissions_bounty_pr_idx").on(t.bountyId, t.prNumber),
    check("submissions_spam_score", sql`${t.spamScore} between 0 and 1`),
  ],
);

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id")
      .notNull()
      .references(() => bounties.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amountXof: integer("amount_xof").notNull(),
    quoteId: text("quote_id"),
    bitnobPayoutId: text("bitnob_payout_id"),
    /** Idempotency key sent to Bitnob: `pay-<bountyId>`. */
    reference: text("reference").notNull().unique(),
    status: payoutStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    paidAt: ts("paid_at"),
    // B6, Lightning: the current attempt's details (reset at each attempt).
    rail: payoutRail("rail").notNull().default("mobile_money"),
    lightningAddress: text("lightning_address"),
    /** Sats sent, floor(amount_xof / xof_per_btc * 1e8). */
    amountSats: bigint("amount_sats", { mode: "number" }),
    /** FCFA per 1 BTC used for amount_sats (an exchange rate, not money). */
    xofPerBtc: doublePrecision("xof_per_btc"),
    /** BOLT11 obtained through LNURL-pay for exactly amount_sats. */
    paymentRequest: text("payment_request"),
    paymentHash: text("payment_hash"),
    invoiceExpiresAt: ts("invoice_expires_at"),
    /** Set before the pay request leaves: from then on only Bitnob can say the attempt failed. */
    sentAt: ts("sent_at"),
    preimage: text("preimage"),
  },
  (t) => [
    // One payout per bounty: retries update this row, they never add one.
    uniqueIndex("payouts_bounty_idx").on(t.bountyId),
    index("payouts_status_idx").on(t.status),
    check("payouts_amount_positive", sql`${t.amountXof} > 0`),
    check("payouts_attempts", sql`${t.attempts} >= 0`),
    check("payouts_amount_sats_positive", sql`${t.amountSats} > 0`),
  ],
);

// --- money and audit ---

export const ledger = pgTable(
  "ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id").references(() => bounties.id),
    kind: ledgerKind("kind").notNull(),
    /** Integer in the currency's smallest unit; negative for money leaving. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: currency("currency").notNull(),
    ref: text("ref"),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_bounty_idx").on(t.bountyId)],
);

/**
 * Inbound webhook audit log + dedupe, and the bounty timeline: one row per
 * (source, external_id). Written by the GitHub receiver (F6, `DrizzleEventStore`
 * in apps/server, `external_id` = X-GitHub-Delivery), the Bitnob receiver (B5,
 * Bitnob event id) and the app itself (`system`). Webhook rows start
 * `received` and end `processed` or `failed`; `bounty_id` is set once known.
 */
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    bountyId: uuid("bounty_id").references(() => bounties.id),
    source: eventSource("source").notNull(),
    externalId: text("external_id").notNull(),
    type: text("type").notNull(),
    action: text("action"),
    /** `owner/name`, when the payload has a repository. */
    repo: text("repo"),
    installationId: bigint("installation_id", { mode: "number" }),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: eventStatus("status").notNull().default("received"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    uniqueIndex("events_source_external_id_uq").on(t.source, t.externalId),
    index("events_bounty_received_idx").on(t.bountyId, t.receivedAt),
    index("events_received_idx").on(t.receivedAt),
    index("events_type_idx").on(t.type, t.action),
  ],
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    /** Hash of the `bb_...` API key, never the key itself. */
    keyHash: text("key_hash").notNull().unique(),
    monthlyBudgetXof: integer("monthly_budget_xof").notNull(),
    perTaskMaxXof: integer("per_task_max_xof").notNull(),
    allowedRepos: text("allowed_repos").array().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    check("agents_budget", sql`${t.monthlyBudgetXof} >= 0 and ${t.perTaskMaxXof} >= 0`),
  ],
);
