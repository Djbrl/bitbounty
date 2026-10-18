import { randomUUID } from "node:crypto";
import {
  createBounty,
  TERMINAL_STATUSES,
  transition,
  type Bounty,
  type InternalEvent,
  type TransitionResult,
} from "@bitbounty/core";
import type { BountyRepo } from "../../bounties/repo.js";
import type { EventBus } from "../pr/ports.js";
import { findCommandLines, parseCommand, resolveRole, type Command, type Role } from "../commands/index.js";
import type { StoredEvent } from "../event-store.js";
import { formatXof, type Lang } from "../status-comment/index.js";
import { syncIssue } from "./sync.js";
import type { GithubWriter, GithubWriterFactory } from "./writer.js";
import type { ClaimTimers } from "../claims/service.js";
import { FundingError, type FundingTarget } from "../../funding/lightning.js";
import type { FundingRecord } from "../../funding/store.js";

/** The slice of B1 `LightningFunding` that `/funded` (sandbox demo) uses. */
export interface SandboxFunding {
  /** True only for Bitnob sandbox keys (and BITNOB_SANDBOX_PAY not 0). */
  canSimulate(): Promise<boolean>;
  /** The same invoice the "Fund this bounty" link creates (POST /api/bounties/:id/funding). */
  invoice(target: FundingTarget): Promise<FundingRecord>;
  simulatePayment(bountyId: string): Promise<FundingRecord>;
}

export interface WiringDeps {
  repo: BountyRepo;
  bus: EventBus;
  writerFor: GithubWriterFactory;
  /** Web app origin for the links in the status comment. */
  baseUrl: string;
  lang?: Lang;
  /** Our app's login, e.g. `bitbounty-dakar[bot]`. Optional: bots are also recognised by type. */
  botLogin?: string;
  /** How long a `/claim` lasts. Default 72 h (G5 owns expiry and `/extend`). */
  claimTtlMs?: number;
  /** G5: claim timers; `/extend` is delegated to it. Without it `/extend` replies "not available". */
  claims?: Pick<ClaimTimers, "extend">;
  /**
   * CR3: does this GitHub login have a payout account settlement can pay (PAYOUT_ACCOUNTS or the
   * Lightning Address saved at onboarding)? `/pay @user` is refused when it says no, or when it's absent.
   */
  hasPayoutAccount?: (login: string) => Promise<boolean>;
  /**
   * `/funded` (live demo): Lightning funding, read lazily (it's built after the wiring in app.ts).
   * Absent or null → `/funded` replies that it's unavailable.
   */
  funding?: () => SandboxFunding | null | undefined;
  now?: () => Date;
  newId?: () => string;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export type CommentOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "replied"; message: string }
  | { kind: "applied"; bounty: Bounty; event: InternalEvent };

const CLAIM_TTL_MS = 72 * 60 * 60 * 1000;

/** Serialises work per issue inside this process, so two commands on one issue never interleave. */
const issueLocks = new Map<string, Promise<unknown>>();
/** The lock key for an issue (G5's expiry timer takes the same lock). */
export const issueLockKey = (repoName: string, issueNumber: number) => `${repoName.toLowerCase()}#${issueNumber}`;
export async function withIssueLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = issueLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  issueLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (issueLocks.get(key) === tail) issueLocks.delete(key);
  }
}

type Json = Record<string, any>;

/**
 * `issue_comment.created` → parse → `transition()` → persist → event → status comment + label.
 * Errors the user can fix get a short reply that quotes the parser or transition error.
 * GitHub API failures throw, so the webhook event is marked `failed`.
 */
export async function handleIssueComment(stored: StoredEvent, deps: WiringDeps): Promise<CommentOutcome> {
  const p = stored.payload as Json;
  const comment = p?.comment;
  const issue = p?.issue;
  const repoName: unknown = p?.repository?.full_name;
  if (!comment || !issue || typeof repoName !== "string" || typeof issue.number !== "number") {
    return { kind: "ignored", reason: "not an issue comment" };
  }
  const body = typeof comment.body === "string" ? comment.body : "";
  const login: string = comment.user?.login ?? "";
  const userType: string | undefined = comment.user?.type;
  if (userType === "Bot" || login.toLowerCase().endsWith("[bot]")) return { kind: "ignored", reason: "bot_author" };
  // Cheap pre-check: most comments aren't commands; don't spend API calls on them.
  if (findCommandLines(body).length === 0) return { kind: "ignored", reason: "no_command" };
  if (stored.installationId === null) return { kind: "ignored", reason: "no installation" };

  const writer = await deps.writerFor(stored.installationId);
  const permission = await writer.getPermission(repoName, login);
  const parsed = parseCommand(body, {
    login,
    type: userType,
    authorAssociation: comment.author_association,
    permission,
    botLogin: deps.botLogin,
  });

  const ctx: Ctx = { deps, writer, repoName, issue, login, lang: deps.lang ?? "en" };
  if (parsed.type === "ignore") return { kind: "ignored", reason: parsed.reason };
  if (parsed.type === "error") return reply(ctx, parsed.message);

  if (issue.pull_request) {
    return reply(ctx, "BitBounty commands go on the issue, not on the pull request.");
  }

  const outcome = await withIssueLock(issueLockKey(repoName, issue.number), () =>
    run(ctx, parsed.command, parsed.role),
  );
  if (outcome.kind === "applied" && parsed.extraCommands.length > 0) {
    const extra = parsed.extraCommands.map((n) => `\`/${n}\``).join(", ");
    await reply(ctx, `One command per comment: I ran \`/${parsed.command.name}\` and ignored ${extra}.`);
  }
  return outcome;
}

interface Ctx {
  deps: WiringDeps;
  writer: GithubWriter;
  repoName: string;
  issue: Json;
  login: string;
  lang: Lang;
  /** U4: the decision came from the web app, which shows the answer itself: don't comment it on GitHub. */
  quiet?: boolean;
}

async function reply(ctx: Ctx, message: string): Promise<CommentOutcome> {
  const text = `@${ctx.login} ${message}`;
  if (!ctx.quiet) await ctx.writer.createComment(ctx.repoName, ctx.issue.number, text);
  return { kind: "replied", message: ctx.quiet ? message : text };
}

/** U4: Pay / Hold from the maintainer home. Same commands as `/pay` and `/hold` on the issue. */
export type MaintainerDecision = { name: "pay" } | { name: "hold"; note: string | null };

export type DecisionOutcome = CommentOutcome | { kind: "forbidden"; message: string };

/**
 * U4: runs a maintainer's Pay / Hold from the web app through the **same** path as the GitHub
 * comment: the repo permission lookup and role check of the parser, the per-issue lock, `run()`
 * (→ `transition()` → persist → bus event → status comment). Settlement then reacts to the event
 * exactly as for `/pay`, so there is no second way to start a payout.
 */
export async function runMaintainerDecision(
  deps: WiringDeps,
  input: { writer: GithubWriter; repoName: string; issueNumber: number; login: string; decision: MaintainerDecision },
): Promise<DecisionOutcome> {
  const { writer, repoName, issueNumber, login, decision } = input;
  const permission = await writer.getPermission(repoName, login);
  const role = resolveRole({ login, type: "User", permission, botLogin: deps.botLogin });
  if (role !== "maintainer") return { kind: "forbidden", message: `@${login} needs write access on ${repoName} to /${decision.name}.` };
  const ctx: Ctx = { deps, writer, repoName, issue: { number: issueNumber, state: "open" }, login, lang: deps.lang ?? "en", quiet: true };
  const command: Command = decision.name === "pay" ? { name: "pay", user: null, now: false } : { name: "hold", note: decision.note };
  return withIssueLock(issueLockKey(repoName, issueNumber), () => run(ctx, command, role));
}

const nowIso = (ctx: Ctx) => (ctx.deps.now?.() ?? new Date()).toISOString();
const newId = (ctx: Ctx) => ctx.deps.newId?.() ?? randomUUID();

async function run(ctx: Ctx, command: Command, role: Role): Promise<CommentOutcome> {
  const { deps, repoName, issue, login } = ctx;
  const closed = issue.state === "closed";

  if (command.name === "bounty") {
    if (closed) return reply(ctx, "This issue is closed. Reopen it before putting a bounty on it.");
    const existing = await deps.repo.findByIssue(repoName, issue.number);
    if (existing) return reply(ctx, alreadyMessage(existing, command.topUp));
    const { bounty, event } = createBounty({
      id: newId(ctx),
      repoFullName: repoName,
      issueNumber: issue.number,
      issueTitle: typeof issue.title === "string" ? issue.title : "",
      amountXof: command.amountXof,
      criteria: [],
      funderKind: "human",
      funderId: `github:${login}`,
      createdAt: nowIso(ctx),
    });
    const res = await deps.repo.create(bounty);
    if (!res.created) return reply(ctx, alreadyMessage(res.bounty, command.topUp));
    return publishAndSync(ctx, res.bounty, event);
  }

  if (command.name === "criteria" || (command.name === "extend" && !deps.claims)) {
    return reply(ctx, `\`/${command.name}\` isn't available yet.`);
  }

  const bounty = await deps.repo.findByIssue(repoName, issue.number);
  if (!bounty) return reply(ctx, "There's no bounty on this issue yet. A maintainer can add one with `/bounty <amount>`.");
  const base = { bountyId: bounty.id, occurredAt: nowIso(ctx) };

  switch (command.name) {
    case "claim": {
      if (closed) return reply(ctx, "This issue is closed, it can't be claimed.");
      const claimId = newId(ctx);
      const result = transition(bounty, { ...base, type: "claim.created", claimId, userId: `github:${login}` });
      return apply(ctx, bounty, result, command.name, async () => {
        const ttl = deps.claimTtlMs ?? CLAIM_TTL_MS;
        await deps.repo.createClaim({
          id: claimId,
          bountyId: bounty.id,
          userId: `github:${login}`,
          login,
          status: "active",
          expiresAt: new Date(Date.parse(base.occurredAt) + ttl).toISOString(),
        });
      });
    }
    case "extend":
      return reply(ctx, await deps.claims!.extend({ bounty, login, role, writer: ctx.writer }));
    case "unclaim": {
      const claim = await deps.repo.activeClaim(bounty.id);
      if (!claim) return reply(ctx, "Nobody has claimed this bounty.");
      if (claim.login.toLowerCase() !== login.toLowerCase() && role !== "maintainer") {
        return reply(ctx, `Only @${claim.login} (who claimed it) or a maintainer can release this claim.`);
      }
      return apply(ctx, bounty, transition(bounty, { ...base, type: "claim.released", claimId: claim.id }), command.name);
    }
    case "pay": {
      const result = transition(bounty, {
        ...base,
        type: "maintainer.pay",
        actorLogin: login,
        ...(command.user ? { toLogin: command.user } : {}),
        ...(command.now ? { now: true } : {}),
      });
      // CR3: `/pay @user` pays @user, so @user must have a payout account before anything moves.
      if (result.ok && command.user && !(await recipientCanBePaid(ctx, command.user))) {
        const meUrl = `${deps.baseUrl.replace(/\/+$/, "")}/me`;
        return reply(
          ctx,
          `@${command.user} has no verified payout account, so I can't pay them. Nothing was paid. ` +
            `They can add a Lightning Address at ${meUrl}, then run \`/pay @${command.user}\` again.`,
        );
      }
      return apply(ctx, bounty, result, command.name);
    }
    case "hold":
      return apply(
        ctx,
        bounty,
        transition(bounty, { ...base, type: "maintainer.hold", actorLogin: login, ...(command.note ? { reason: command.note } : {}) }),
        command.name,
      );
    case "reject":
      return apply(
        ctx,
        bounty,
        transition(bounty, { ...base, type: "maintainer.reject", actorLogin: login, reason: command.reason }),
        command.name,
      );
    case "funded":
      return simulateFunding(ctx, bounty);
    case "cancel":
      return apply(
        ctx,
        bounty,
        transition(bounty, {
          ...base,
          type: "bounty.cancelled",
          actorId: `github:${login}`,
          reason: command.note ?? `/cancel by @${login}`,
        }),
        command.name,
      );
  }
}

const FUNDED_COPY = {
  en: {
    already: "This bounty is already funded, nothing to do.",
    notFundable: (status: string) => `This bounty is ${status}, it can't be funded.`,
    unavailable: "`/funded` only works with Bitnob sandbox keys (demo mode). Nothing was paid.",
    done: "Sandbox payment simulated: the bounty is funded. Developers can `/claim` it.",
    pending: "Sandbox payment sent; Bitnob hasn't confirmed it yet. The status comment updates once it does.",
    failed: (msg: string) => `The sandbox payment couldn't be simulated: ${msg}`,
  },
  fr: {
    already: "Cette prime est déjà financée, rien à faire.",
    notFundable: (status: string) => `Cette prime est ${status}, elle ne peut pas être financée.`,
    unavailable: "`/funded` ne marche qu'avec des clés Bitnob sandbox (mode démo). Rien n'a été payé.",
    done: "Paiement sandbox simulé : la prime est financée. Les devs peuvent faire `/claim`.",
    pending: "Paiement sandbox envoyé ; Bitnob ne l'a pas encore confirmé. Le commentaire de statut se mettra à jour.",
    failed: (msg: string) => `Le paiement sandbox n'a pas pu être simulé : ${msg}`,
  },
} as const;

/**
 * `/funded` (live demo): sandbox keys only. Creates the funding invoice if there's none (same flow
 * as the fund link), settles it with Bitnob's simulate-payment, then the normal `funding.paid` path
 * moves the bounty to `funded` and settlement re-renders the status comment.
 */
async function simulateFunding(ctx: Ctx, bounty: Bounty): Promise<CommentOutcome> {
  const copy = FUNDED_COPY[ctx.lang] ?? FUNDED_COPY.en;
  if (bounty.status === "cancelled" || bounty.status === "refunded") return reply(ctx, copy.notFundable(bounty.status));
  if (bounty.status !== "unfunded") return reply(ctx, copy.already);
  const funding = ctx.deps.funding?.();
  if (!funding || !(await funding.canSimulate())) return reply(ctx, copy.unavailable);
  try {
    let f: FundingRecord;
    try {
      f = await funding.simulatePayment(bounty.id);
    } catch (err) {
      if (!(err instanceof FundingError && err.code === "NO_PENDING_INVOICE")) throw err;
      await funding.invoice({ bountyId: bounty.id, funderId: bounty.funderId });
      f = await funding.simulatePayment(bounty.id);
    }
    const after = (await ctx.deps.repo.findById(bounty.id)) ?? bounty;
    if (after.status === "unfunded") return reply(ctx, f.status === "paid" ? copy.done : copy.pending);
    // Settlement also re-renders on funding.paid; syncing here too makes the demo instant (edited in place).
    await syncStatus(ctx, after);
    return reply(ctx, copy.done);
  } catch (err) {
    if (err instanceof FundingError) {
      if (err.code === "ALREADY_FUNDED") return reply(ctx, copy.already);
      if (err.code === "SANDBOX_ONLY") return reply(ctx, copy.unavailable);
      return reply(ctx, copy.failed(err.message));
    }
    ctx.deps.log?.error(`[wiring] /funded on ${bounty.id} failed: ${err instanceof Error ? err.message : err}`);
    return reply(ctx, copy.failed("Bitnob error, try again in a moment."));
  }
}

/** CR3: `/pay @user` only goes through when settlement will be able to pay @user. */
async function recipientCanBePaid(ctx: Ctx, login: string): Promise<boolean> {
  if (!ctx.deps.hasPayoutAccount) return false;
  try {
    return await ctx.deps.hasPayoutAccount(login);
  } catch (err) {
    ctx.deps.log?.error(`[wiring] payout account lookup for @${login} failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

function alreadyMessage(existing: Bounty, topUp: boolean): string {
  const what = `This issue already has a bounty of ${formatXof(existing.amountXof)} (${existing.status.replace("_", " ")}).`;
  if (TERMINAL_STATUSES.includes(existing.status)) return `${what} It's closed for good.`;
  return topUp ? `${what} Top-ups aren't supported yet.` : what;
}

/** Hints for the most common illegal moves, shown above the raw transition error. */
const STATUS_HINT: Partial<Record<Bounty["status"], string>> = {
  unfunded: "This bounty isn't funded yet.",
  claimed: "Someone already claimed this bounty.",
  submitted: "A PR is already in for this bounty.",
  paid: "This bounty is already paid.",
  refunded: "This bounty was refunded.",
  cancelled: "This bounty was cancelled.",
};

async function apply(
  ctx: Ctx,
  bounty: Bounty,
  result: TransitionResult,
  name: Command["name"],
  beforeSync?: () => Promise<void>,
): Promise<CommentOutcome> {
  if (!result.ok) {
    const hint = STATUS_HINT[result.from];
    return reply(ctx, `${hint ? hint + " " : ""}\`/${name}\` can't run now:\n> ${result.message}`);
  }
  const saved = await ctx.deps.repo.update(result.bounty, result.from);
  if (!saved) {
    // Someone else moved the bounty between our read and our write (e.g. two /claim at once).
    const fresh = (await ctx.deps.repo.findById(bounty.id)) ?? bounty;
    const hint = STATUS_HINT[fresh.status];
    return reply(ctx, `${hint ?? "The bounty changed while I was working on it."} \`/${name}\` wasn't applied.`);
  }
  if (beforeSync) await beforeSync();
  // Leaving `claimed`/`submitted` for an open or closed state ends the claim.
  if (["funded", "refunded", "cancelled"].includes(saved.status)) {
    const claim = await ctx.deps.repo.activeClaim(saved.id);
    if (claim) await ctx.deps.repo.setClaimStatus(claim.id, "released");
  }
  return publishAndSync(ctx, saved, result.event);
}

async function publishAndSync(ctx: Ctx, bounty: Bounty, event: InternalEvent): Promise<CommentOutcome> {
  await ctx.deps.bus.publish(event);
  const commentId = await syncStatus(ctx, bounty);
  return { kind: "applied", bounty: { ...bounty, statusCommentId: commentId }, event };
}

async function syncStatus(ctx: Ctx, bounty: Bounty) {
  const claim = await ctx.deps.repo.activeClaim(bounty.id);
  const commentId = await syncIssue(bounty, {
    writer: ctx.writer,
    repo: ctx.deps.repo,
    baseUrl: ctx.deps.baseUrl,
    lang: ctx.lang,
    botLogin: ctx.deps.botLogin,
    extras: claim ? { claim: { login: claim.login, expiresAt: claim.expiresAt } } : {},
  });
  return commentId;
}
