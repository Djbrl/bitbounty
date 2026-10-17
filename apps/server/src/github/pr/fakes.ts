import type { Bounty, EventType, InternalEvent, Submission } from "@bitbounty/core";
import type {
  BountyRepo,
  Claimant,
  CiReader,
  CommentTarget,
  EventBus,
  EventHandler,
  PrNotifier,
} from "./ports.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** In-memory `BountyRepo` for tests and the offline demo (until F3's DB). */
export class InMemoryBountyRepo implements BountyRepo {
  readonly bounties = new Map<string, Bounty>();
  readonly claimants = new Map<string, Claimant>();
  readonly submissions = new Map<string, Submission>();

  /** Seeds a bounty, optionally with an active claimant. */
  add(bounty: Bounty, claimant?: Claimant): this {
    this.bounties.set(bounty.id, bounty);
    if (claimant) this.claimants.set(bounty.id, claimant);
    return this;
  }

  async findById(id: string) {
    return this.bounties.get(id);
  }

  async findByIssue(repoFullName: string, issueNumber: number) {
    for (const b of this.bounties.values()) {
      if (same(b.repoFullName, repoFullName) && b.issueNumber === issueNumber) return b;
    }
    return undefined;
  }

  async activeClaimant(bountyId: string) {
    return this.claimants.get(bountyId);
  }

  async currentSubmission(bountyId: string) {
    let latest: Submission | undefined;
    for (const s of this.submissions.values()) if (s.bountyId === bountyId) latest = s;
    return latest;
  }

  async submissionsForPr(repoFullName: string, prNumber: number) {
    return [...this.submissions.values()].filter((s) => {
      const b = this.bounties.get(s.bountyId);
      return s.prNumber === prNumber && b !== undefined && same(b.repoFullName, repoFullName);
    });
  }

  async openBountiesClaimedBy(repoFullName: string, login: string) {
    return [...this.bounties.values()].filter((b) => {
      const c = this.claimants.get(b.id);
      return (
        same(b.repoFullName, repoFullName) &&
        (b.status === "claimed" || b.status === "submitted") &&
        c !== undefined &&
        same(c.login, login)
      );
    });
  }

  async saveBounty(bounty: Bounty) {
    this.bounties.set(bounty.id, bounty);
  }

  async saveSubmission(submission: Submission) {
    // Re-insert so the Map's order keeps "latest saved" last.
    this.submissions.delete(submission.id);
    this.submissions.set(submission.id, submission);
  }
}

/** In-memory bus: delivers synchronously to subscribers and keeps every event in `published`. */
export class InMemoryEventBus implements EventBus {
  readonly published: InternalEvent[] = [];
  private handlers = new Map<EventType, EventHandler[]>();

  async publish(event: InternalEvent): Promise<void> {
    this.published.push(event);
    for (const h of this.handlers.get(event.type) ?? []) await h(event as never);
  }

  subscribe<T extends EventType>(type: T, handler: EventHandler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as unknown as EventHandler);
    this.handlers.set(type, list);
  }
}

/** Records comments instead of posting them. */
export class RecordingNotifier implements PrNotifier {
  readonly comments: Array<CommentTarget & { body: string }> = [];
  async comment(target: CommentTarget, body: string) {
    this.comments.push({ ...target, body });
  }
}

/** Logs comments to stdout; used when no GitHub App credentials are set. */
export class ConsoleNotifier implements PrNotifier {
  async comment(target: CommentTarget, body: string) {
    console.log(`[pr] comment on ${target.repo}#${target.issueNumber}:\n${body}`);
  }
}

/** CI reader with a fixed answer. */
export class FixedCiReader implements CiReader {
  constructor(public green = true) {}
  async isGreen() {
    return this.green;
  }
}
