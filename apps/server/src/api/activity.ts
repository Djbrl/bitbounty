import { EVENT_TYPES, type BountyStatus, type EventType, type InternalEvent } from "@bitbounty/core";
import type { EventBus } from "../github/pr/ports.js";
import { groupThousands } from "./format.js";

/** One applied internal event, as the bounty page timeline and the /live screen show it. */
export interface ActivityEntry {
  bountyId: string;
  type: EventType;
  /** Status before the event (null for `bounty.created`). */
  from: BountyStatus | null;
  /** Status after the event, read back from the repo once the event is published. */
  to: BountyStatus;
  occurredAt: string;
  /** GitHub login, "bitbounty" or "bitnob". */
  actor: string;
  text: string;
}

export type ActivityListener = (entry: ActivityEntry) => void;

interface StatusReader {
  findById(id: string): Promise<{ status: BountyStatus } | undefined>;
}

/**
 * Listens to every internal event and keeps the recent ones per bounty (timeline) and
 * globally (live feed), and pushes each new one to SSE listeners.
 *
 * In memory: a restart starts with empty timelines (pages then show the creation date only).
 * Events are published after the bounty is saved, so the status read back is the new one.
 */
export class ActivityLog {
  private readonly byBounty = new Map<string, ActivityEntry[]>();
  private readonly recentEntries: ActivityEntry[] = [];
  private readonly lastStatus = new Map<string, BountyStatus>();
  private readonly listeners = new Set<ActivityListener>();

  constructor(
    private readonly repo: StatusReader,
    private readonly opts: { perBounty?: number; recent?: number } = {},
  ) {}

  attach(bus: Pick<EventBus, "subscribe">): this {
    for (const type of EVENT_TYPES) {
      bus.subscribe(type, async (e) => {
        await this.record(e as InternalEvent);
      });
    }
    return this;
  }

  async record(event: InternalEvent): Promise<ActivityEntry | undefined> {
    const bounty = await this.repo.findById(event.bountyId);
    if (!bounty) return undefined;
    const from = event.type === "bounty.created" ? null : (this.lastStatus.get(event.bountyId) ?? null);
    const entry: ActivityEntry = {
      bountyId: event.bountyId,
      type: event.type,
      from,
      to: bounty.status,
      occurredAt: event.occurredAt,
      actor: actorOf(event),
      text: describe(event),
    };
    this.lastStatus.set(event.bountyId, bounty.status);
    const list = this.byBounty.get(event.bountyId) ?? [];
    list.push(entry);
    if (list.length > (this.opts.perBounty ?? 200)) list.shift();
    this.byBounty.set(event.bountyId, list);
    this.recentEntries.push(entry);
    if (this.recentEntries.length > (this.opts.recent ?? 500)) this.recentEntries.shift();
    for (const fn of this.listeners) {
      try {
        fn(entry);
      } catch {
        // a broken SSE client must not stop the others
      }
    }
    return entry;
  }

  timeline(bountyId: string): ActivityEntry[] {
    return [...(this.byBounty.get(bountyId) ?? [])];
  }

  /** Latest entry time for a bounty (its `updatedAt`), if any. */
  lastAt(bountyId: string): string | undefined {
    return this.byBounty.get(bountyId)?.at(-1)?.occurredAt;
  }

  recent(limit = 50): ActivityEntry[] {
    return this.recentEntries.slice(-limit);
  }

  subscribe(fn: ActivityListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

const loginOf = (id: string | undefined) => (id?.startsWith("github:") ? id.slice(7) : undefined);
const fcfa = (n: number) => `${groupThousands(n)} FCFA`;

function actorOf(e: InternalEvent): string {
  switch (e.type) {
    case "claim.created":
      return loginOf(e.userId) ?? "bitbounty";
    case "pr.linked":
      return e.authorLogin;
    case "maintainer.pay":
    case "maintainer.hold":
    case "maintainer.reject":
      return e.actorLogin;
    case "bounty.cancelled":
      return loginOf(e.actorId) ?? (e.actorId.startsWith("agent:") ? "agent" : "bitbounty");
    case "funding.paid":
    case "payout.started":
    case "payout.succeeded":
    case "payout.failed":
      return "bitnob";
    default:
      return "bitbounty";
  }
}

function describe(e: InternalEvent): string {
  switch (e.type) {
    case "bounty.created":
      return `Bounty created: ${fcfa(e.amountXof)}`;
    case "funding.paid":
      return `Funded over ${e.rail === "ngn" ? "a naira bank transfer" : e.rail === "usdt" ? "USDT" : "Lightning"}`;
    case "claim.created":
      return `Claimed by @${loginOf(e.userId) ?? "a developer"}`;
    case "claim.released":
      return "Claim released";
    case "claim.expired":
      return "Claim expired";
    case "pr.linked":
      return `PR #${e.prNumber} opened by @${e.authorLogin}`;
    case "verify.done":
      return `Claude's check: ${e.verdict}`;
    case "pr.merged":
      return `PR #${e.prNumber} merged${e.ciGreen ? "" : " (CI not green)"}`;
    case "maintainer.pay":
      return `@${e.actorLogin} approved the payment`;
    case "maintainer.hold":
      return `@${e.actorLogin} put it on hold`;
    case "maintainer.reject":
      return `@${e.actorLogin} rejected the PR`;
    case "bounty.cancelled":
      return `Cancelled: ${e.reason}`;
    case "payout.started":
      return "Payout started";
    case "payout.succeeded":
      return "Paid on mobile money";
    case "payout.failed":
      return "Payout failed, will retry";
  }
}
