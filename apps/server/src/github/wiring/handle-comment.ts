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
import { findCommandLines, parseCommand, type Command, type Role } from "../commands/index.js";
import type { StoredEvent } from "../event-store.js";
import { formatXof, type Lang } from "../status-comment/index.js";
import { syncIssue } from "./sync.js";
import type { GithubWriter, GithubWriterFactory } from "./writer.js";

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
async function withIssueLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
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

  const outcome = await withIssueLock(`${repoName.toLowerCase()}#${issue.number}`, () =>
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
}

async function reply(ctx: Ctx, message: string): Promise<CommentOutcome> {
  const text = `@${ctx.login} ${message}`;
  await ctx.writer.createComment(ctx.repoName, ctx.issue.number, text);
  return { kind: "replied", message: text };
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

  if (command.name === "extend" || command.name === "criteria") {
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
    case "unclaim": {
      const claim = await deps.repo.activeClaim(bounty.id);
      if (!claim) return reply(ctx, "Nobody has claimed this bounty.");
      if (claim.login.toLowerCase() !== login.toLowerCase() && role !== "maintainer") {
        return reply(ctx, `Only @${claim.login} (who claimed it) or a maintainer can release this claim.`);
      }
      return apply(ctx, bounty, transition(bounty, { ...base, type: "claim.released", claimId: claim.id }), command.name);
    }
    case "pay":
      return apply(
        ctx,
        bounty,
        transition(bounty, { ...base, type: "maintainer.pay", actorLogin: login, ...(command.user ? { toLogin: command.user } : {}) }),
        command.name,
      );
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
  const claim = await ctx.deps.repo.activeClaim(bounty.id);
  const commentId = await syncIssue(bounty, {
    writer: ctx.writer,
    repo: ctx.deps.repo,
    baseUrl: ctx.deps.baseUrl,
    lang: ctx.lang,
    botLogin: ctx.deps.botLogin,
    extras: claim ? { claim: { login: claim.login, expiresAt: claim.expiresAt } } : {},
  });
  return { kind: "applied", bounty: { ...bounty, statusCommentId: commentId }, event };
}
