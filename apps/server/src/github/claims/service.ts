import { transition, type Bounty, type EventOf } from "@bitbounty/core";
import type { BountyRepo, ClaimRecord } from "../../bounties/repo.js";
import type { Role } from "../commands/index.js";
import type { EventBus } from "../pr/ports.js";
import { formatDate, mention, type Lang } from "../status-comment/index.js";
import { issueLockKey, withIssueLock } from "../wiring/handle-comment.js";
import { syncIssue } from "../wiring/sync.js";
import type { GithubWriter } from "../wiring/writer.js";
import type { GithubForRepo } from "./github.js";
import type { ClaimScheduler, DueClaim } from "./scheduler.js";

/** `/extend` works this many times per claim. The status comment says "(once)". */
export const MAX_EXTENSIONS = 1;

export interface ClaimTimerDeps {
  repo: BountyRepo;
  bus: EventBus;
  scheduler: ClaimScheduler;
  github: GithubForRepo;
  /** Claim length, also what one `/extend` adds. */
  ttlMs: number;
  baseUrl: string;
  lang?: Lang;
  botLogin?: string;
  now?: () => Date;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export type ExpireOutcome =
  | { kind: "expired"; bountyId: string; claimId: string; login: string }
  | { kind: "skipped"; reason: "no_claim" | "not_active" | "not_due" | "no_bounty" | "not_claimed" | "race" };

export interface ExtendInput {
  bounty: Bounty;
  login: string;
  role: Role;
  writer: GithubWriter;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * G5: claims expire after `ttlMs` without a PR. On `claim.created` the claimant is assigned
 * and a timer armed; when it fires, `claim.expired` goes through `transition()`, the issue
 * is unassigned, the status comment re-rendered (G3's `syncIssue`) and a note posted.
 * A linked PR (`submitted`) stops the clock for good.
 */
export class ClaimTimers {
  /** Claims expired in this process, by bounty: a PR linked in the same instant restores them. */
  private justExpired = new Map<string, ClaimRecord>();

  constructor(private readonly deps: ClaimTimerDeps) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }
  private get log() {
    return this.deps.log ?? console;
  }
  private get lang(): Lang {
    return this.deps.lang ?? "en";
  }

  /** Subscribes to the bus and starts the scheduler (re-arming claims already in the repo). */
  async start(): Promise<void> {
    const { bus, scheduler } = this.deps;
    bus.subscribe("claim.created", (e) => this.onClaimCreated(e));
    bus.subscribe("claim.released", (e) => this.onClaimReleased(e));
    bus.subscribe("pr.linked", (e) => this.onPrLinked(e));
    await scheduler.start((due) => this.expire(due).then(() => undefined));
  }

  stop(): void {
    this.deps.scheduler.stop();
  }

  /** What the scheduler should be timing: active claims on bounties still `claimed`. */
  async pending(): Promise<DueClaim[]> {
    const out: DueClaim[] = [];
    for (const c of await this.deps.repo.listActiveClaims()) {
      const b = await this.deps.repo.findById(c.bountyId);
      if (b?.status === "claimed") out.push({ claimId: c.id, expiresAt: c.expiresAt });
    }
    return out;
  }

  private async onClaimCreated(e: EventOf<"claim.created">) {
    const claim = await this.deps.repo.findClaim(e.claimId);
    const bounty = await this.deps.repo.findById(e.bountyId);
    if (!claim || !bounty) return;
    this.deps.scheduler.schedule({ claimId: claim.id, expiresAt: claim.expiresAt });
    await this.quietly("assign", async () => {
      const gh = await this.deps.github(bounty.repoFullName);
      await gh.assigner.addAssignees(bounty.repoFullName, bounty.issueNumber, [claim.login]);
    });
  }

  private async onClaimReleased(e: EventOf<"claim.released">) {
    this.deps.scheduler.cancel(e.claimId);
    const claim = await this.deps.repo.findClaim(e.claimId);
    const bounty = await this.deps.repo.findById(e.bountyId);
    if (!claim || !bounty) return;
    await this.quietly("unassign", async () => {
      const gh = await this.deps.github(bounty.repoFullName);
      await gh.assigner.removeAssignees(bounty.repoFullName, bounty.issueNumber, [claim.login]);
    });
  }

  /**
   * A PR stops the clock. If the timer won a photo finish (G4 read `claimed`, we expired,
   * G4 then saved `submitted`), the claimant's PR wins: the claim comes back.
   */
  private async onPrLinked(e: EventOf<"pr.linked">) {
    const { repo } = this.deps;
    const active = await repo.activeClaim(e.bountyId);
    if (active) {
      this.deps.scheduler.cancel(active.id);
      return;
    }
    const lost = this.justExpired.get(e.bountyId);
    const bounty = await repo.findById(e.bountyId);
    if (!lost || !bounty || bounty.status !== "submitted" || !same(lost.login, e.authorLogin)) return;
    this.justExpired.delete(e.bountyId);
    await repo.setClaimStatus(lost.id, "active");
    this.log.info(`[claims] ${bounty.repoFullName}#${bounty.issueNumber}: PR #${e.prNumber} raced the expiry, claim restored`);
    await this.quietly("restore", async () => {
      const gh = await this.deps.github(bounty.repoFullName);
      await gh.assigner.addAssignees(bounty.repoFullName, bounty.issueNumber, [lost.login]);
      await this.sync(bounty, gh.writer, lost, { number: e.prNumber, authorLogin: e.authorLogin });
    });
  }

  /** The timer fired. Idempotent: a second call, or a call after `/unclaim`, a PR or `/extend`, does nothing. */
  async expire(due: DueClaim): Promise<ExpireOutcome> {
    const { repo } = this.deps;
    const first = await repo.findClaim(due.claimId);
    if (!first) return { kind: "skipped", reason: "no_claim" };
    const b0 = await repo.findById(first.bountyId);
    if (!b0) return { kind: "skipped", reason: "no_bounty" };

    return withIssueLock(issueLockKey(b0.repoFullName, b0.issueNumber), async (): Promise<ExpireOutcome> => {
      const claim = await repo.findClaim(due.claimId);
      if (!claim || claim.status !== "active") return { kind: "skipped", reason: "not_active" };
      if (Date.parse(claim.expiresAt) > this.now().getTime()) {
        this.deps.scheduler.schedule({ claimId: claim.id, expiresAt: claim.expiresAt }); // extended meanwhile
        return { kind: "skipped", reason: "not_due" };
      }
      const bounty = await repo.findById(claim.bountyId);
      if (!bounty) return { kind: "skipped", reason: "no_bounty" };
      // A PR linked before the deadline wins: submitted bounties never expire.
      if (bounty.status !== "claimed") return { kind: "skipped", reason: "not_claimed" };

      const event = {
        type: "claim.expired" as const,
        bountyId: bounty.id,
        occurredAt: this.now().toISOString(),
        claimId: claim.id,
      };
      const r = transition(bounty, event);
      if (!r.ok) return { kind: "skipped", reason: "not_claimed" };
      const saved = await repo.update(r.bounty, r.from);
      if (!saved) return { kind: "skipped", reason: "race" };
      await repo.setClaimStatus(claim.id, "expired");
      this.justExpired.set(bounty.id, claim);
      await this.deps.bus.publish(event);
      this.log.info(`[claims] ${bounty.repoFullName}#${bounty.issueNumber}: claim by @${claim.login} expired`);

      // The state change is committed; GitHub failures are logged, not retried into a double expiry.
      await this.quietly("expiry on GitHub", async () => {
        const gh = await this.deps.github(saved.repoFullName);
        await this.sync(saved, gh.writer, null);
        await gh.assigner.removeAssignees(saved.repoFullName, saved.issueNumber, [claim.login]);
        await gh.writer.createComment(saved.repoFullName, saved.issueNumber, expiredNote(claim.login, this.lang));
      });
      return { kind: "expired", bountyId: bounty.id, claimId: claim.id, login: claim.login };
    });
  }

  /**
   * `/extend`: the claimant or a maintainer pushes the deadline back by one TTL, at most
   * `MAX_EXTENSIONS` times. Runs inside G3's issue lock. Returns the reply text.
   */
  async extend({ bounty, login, role, writer }: ExtendInput): Promise<string> {
    const { repo } = this.deps;
    if (bounty.status === "submitted") return "A PR is already linked, so this claim no longer expires.";
    const claim = bounty.status === "claimed" ? await repo.activeClaim(bounty.id) : undefined;
    if (!claim) return "Nobody has claimed this bounty, there's nothing to extend.";
    if (!same(claim.login, login) && role !== "maintainer") {
      return `Only @${claim.login} (who claimed it) or a maintainer can extend this claim.`;
    }
    const used = claim.extensions ?? 0;
    const until = formatDate(claim.expiresAt, this.lang);
    if (used >= MAX_EXTENSIONS) {
      return `This claim was already extended ${MAX_EXTENSIONS === 1 ? "once" : `${MAX_EXTENSIONS} times`}, the limit. It still runs until ${until}.`;
    }
    const now = this.now().getTime();
    if (Date.parse(claim.expiresAt) <= now) return `This claim ran out at ${until}, it can't be extended.`;

    const expiresAt = new Date(Date.parse(claim.expiresAt) + this.deps.ttlMs).toISOString();
    await repo.extendClaim(claim.id, expiresAt, used + 1);
    this.deps.scheduler.schedule({ claimId: claim.id, expiresAt });
    await this.sync(bounty, writer, { ...claim, expiresAt });
    return `Claim extended until ${formatDate(expiresAt, this.lang)} (${used + 1}/${MAX_EXTENSIONS}).`;
  }

  private async sync(
    bounty: Bounty,
    writer: GithubWriter,
    claim: Pick<ClaimRecord, "login" | "expiresAt"> | null,
    pr?: { number: number; authorLogin: string },
  ) {
    const fresh = (await this.deps.repo.findById(bounty.id)) ?? bounty;
    await syncIssue(fresh, {
      writer,
      repo: this.deps.repo,
      baseUrl: this.deps.baseUrl,
      lang: this.lang,
      botLogin: this.deps.botLogin,
      extras: { ...(claim ? { claim: { login: claim.login, expiresAt: claim.expiresAt } } : {}), ...(pr ? { pr } : {}) },
    });
  }

  private async quietly(what: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      this.log.error(`[claims] ${what} failed`, err);
    }
  }
}

export function expiredNote(login: string, lang: Lang): string {
  return lang === "fr"
    ? `⏰ La réservation de ${mention(login)} a expiré sans PR. La prime est de nouveau ouverte : \`/claim\` pour la prendre.`
    : `⏰ ${mention(login)}'s claim expired without a PR. The bounty is open again: comment \`/claim\` to take it.`;
}
