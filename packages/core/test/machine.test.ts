import { describe, expect, it } from "vitest";
import {
  BOUNTY_STATUSES,
  EVENT_TYPES,
  InvalidAmountError,
  TERMINAL_STATUSES,
  TRANSITIONS,
  assertAmount,
  canTransition,
  createBounty,
  isEventType,
  transition,
  type Bounty,
  type BountyStatus,
  type EventOf,
  type EventType,
  type InternalEvent,
} from "../src/index.js";

const AT = "2026-10-17T15:00:00.000Z";

function newBounty(overrides: Partial<Bounty> = {}): Bounty {
  const { bounty } = createBounty({
    id: "b1",
    repoFullName: "Djbrl/demo",
    issueNumber: 12,
    issueTitle: "Fix the date parser",
    amountXof: 10_000,
    criteria: [{ text: "Parses DD/MM/YYYY" }],
    funderKind: "human",
    funderId: "u-funder",
    createdAt: AT,
  });
  return { ...bounty, ...overrides };
}

/** A valid event of each type for bounty b1. */
const SAMPLE: { [T in EventType]: EventOf<T> } = {
  "bounty.created": { type: "bounty.created", bountyId: "b1", occurredAt: AT, amountXof: 10_000 },
  "funding.paid": {
    type: "funding.paid",
    bountyId: "b1",
    occurredAt: AT,
    fundingId: "f1",
    rail: "lightning",
    amountXof: 10_000,
  },
  "claim.created": {
    type: "claim.created",
    bountyId: "b1",
    occurredAt: AT,
    claimId: "c1",
    userId: "u-dev",
  },
  "claim.released": { type: "claim.released", bountyId: "b1", occurredAt: AT, claimId: "c1" },
  "claim.expired": { type: "claim.expired", bountyId: "b1", occurredAt: AT, claimId: "c1" },
  "pr.linked": {
    type: "pr.linked",
    bountyId: "b1",
    occurredAt: AT,
    prNumber: 34,
    authorLogin: "awa",
    headSha: "abc123",
  },
  "verify.done": {
    type: "verify.done",
    bountyId: "b1",
    occurredAt: AT,
    prNumber: 34,
    headSha: "abc123",
    verdict: "pass",
  },
  "pr.merged": { type: "pr.merged", bountyId: "b1", occurredAt: AT, prNumber: 34, ciGreen: true },
  "maintainer.pay": { type: "maintainer.pay", bountyId: "b1", occurredAt: AT, actorLogin: "jib" },
  "maintainer.hold": { type: "maintainer.hold", bountyId: "b1", occurredAt: AT, actorLogin: "jib" },
  "maintainer.reject": {
    type: "maintainer.reject",
    bountyId: "b1",
    occurredAt: AT,
    actorLogin: "jib",
    reason: "out of scope",
  },
  "bounty.cancelled": {
    type: "bounty.cancelled",
    bountyId: "b1",
    occurredAt: AT,
    actorId: "u-funder",
    reason: "changed plans",
  },
  "payout.started": {
    type: "payout.started",
    bountyId: "b1",
    occurredAt: AT,
    payoutId: "p1",
    attempt: 1,
  },
  "payout.succeeded": {
    type: "payout.succeeded",
    bountyId: "b1",
    occurredAt: AT,
    payoutId: "p1",
    bitnobPayoutId: "PAYOUT_1",
  },
  "payout.failed": {
    type: "payout.failed",
    bountyId: "b1",
    occurredAt: AT,
    payoutId: "p1",
    attempt: 1,
    error: "withdrawal.expired",
  },
};

/** Runs events in order and fails the test on the first illegal one. */
function run(bounty: Bounty, events: InternalEvent[]): Bounty {
  let b = bounty;
  for (const e of events) {
    const r = transition(b, e);
    if (!r.ok) throw new Error(`${e.type} from ${b.status}: ${r.message}`);
    b = r.bounty;
  }
  return b;
}

function at(status: BountyStatus, overrides: Partial<Bounty> = {}): Bounty {
  return newBounty({ status, ...overrides });
}

describe("createBounty", () => {
  it("starts unfunded with no verdict and emits bounty.created", () => {
    const { bounty, event } = createBounty({
      id: "b9",
      repoFullName: "a/b",
      issueNumber: 1,
      issueTitle: "t",
      amountXof: 5_000,
      criteria: [],
      funderKind: "agent",
      funderId: "agent-1",
      createdAt: AT,
    });
    expect(bounty.status).toBe("unfunded");
    expect(bounty.verdict).toBeNull();
    expect(bounty.statusCommentId).toBeNull();
    expect(event).toEqual({ type: "bounty.created", bountyId: "b9", occurredAt: AT, amountXof: 5_000 });
  });

  it.each([0, -1, 10.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "10000"])(
    "rejects amount %s",
    (amountXof) => {
      expect(() => createBounty({ ...newBounty(), amountXof: amountXof as number })).toThrow(
        InvalidAmountError,
      );
    },
  );
});

describe("happy path", () => {
  it("unfunded → funded → claimed → submitted → verified → paying → paid", () => {
    const seen: BountyStatus[] = [];
    let b = newBounty();
    for (const type of [
      "funding.paid",
      "claim.created",
      "pr.linked",
      "verify.done",
      "pr.merged",
      "payout.started",
      "payout.succeeded",
    ] as const) {
      const r = transition(b, SAMPLE[type]);
      expect(r.ok, `${type} from ${b.status}`).toBe(true);
      if (r.ok) b = r.bounty;
      seen.push(b.status);
    }
    expect(seen).toEqual(["funded", "claimed", "submitted", "submitted", "verified", "paying", "paid"]);
  });

  it("does not mutate the input bounty", () => {
    const b = newBounty();
    const snapshot = structuredClone(b);
    transition(b, SAMPLE["funding.paid"]);
    expect(b).toEqual(snapshot);
  });

  it("returns from, to and the event", () => {
    const r = transition(newBounty(), SAMPLE["funding.paid"]);
    expect(r).toMatchObject({ ok: true, from: "unfunded", to: "funded", event: SAMPLE["funding.paid"] });
  });
});

describe("illegal moves (reviewer checklist)", () => {
  it("paid → claimed is refused", () => {
    const r = transition(at("paid"), SAMPLE["claim.created"]);
    expect(r).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION", from: "paid" });
  });

  it("claim on an unfunded bounty is refused", () => {
    const r = transition(newBounty(), SAMPLE["claim.created"]);
    expect(r).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION", from: "unfunded" });
  });

  it("paying twice is refused", () => {
    const paid = run(at("verified", { verdict: "pass" }), [
      SAMPLE["payout.started"],
      SAMPLE["payout.succeeded"],
    ]);
    expect(paid.status).toBe("paid");
    expect(transition(paid, SAMPLE["payout.succeeded"]).ok).toBe(false);
    expect(transition(paid, SAMPLE["payout.started"]).ok).toBe(false);
    expect(transition(paid, SAMPLE["maintainer.pay"]).ok).toBe(false);
  });

  it("funding twice is refused", () => {
    const funded = run(newBounty(), [SAMPLE["funding.paid"]]);
    expect(transition(funded, SAMPLE["funding.paid"]).ok).toBe(false);
  });

  it("a payout can't succeed without being started", () => {
    expect(transition(at("verified"), SAMPLE["payout.succeeded"]).ok).toBe(false);
  });

  it("the funder can't cancel once a PR is submitted", () => {
    for (const s of ["submitted", "verified", "paying", "on_hold", "payout_failed"] as const) {
      expect(transition(at(s), SAMPLE["bounty.cancelled"]).ok, s).toBe(false);
    }
  });

  it("refuses an event for another bounty", () => {
    const r = transition(newBounty(), { ...SAMPLE["funding.paid"], bountyId: "other" });
    expect(r).toMatchObject({ ok: false, code: "WRONG_BOUNTY" });
  });

  it("terminal statuses accept no event at all", () => {
    for (const s of TERMINAL_STATUSES) {
      for (const type of EVENT_TYPES) {
        expect(transition(at(s), SAMPLE[type]).ok, `${type} from ${s}`).toBe(false);
      }
    }
  });

  it("refuses an unknown status coming from the database", () => {
    const r = transition(at("weird" as BountyStatus), SAMPLE["funding.paid"]);
    expect(r).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
  });
});

describe("funding.paid amounts", () => {
  it.each([9_999, 0, -10_000, 10_000.5, Number.NaN])("refuses %s FCFA for a 10,000 bounty", (amountXof) => {
    const r = transition(newBounty(), { ...SAMPLE["funding.paid"], amountXof });
    expect(r).toMatchObject({ ok: false, code: "UNDERFUNDED" });
  });

  it("accepts an over-payment (the extra goes to the funder's balance, not the bounty)", () => {
    const r = transition(newBounty(), { ...SAMPLE["funding.paid"], amountXof: 10_300 });
    expect(r.ok && r.bounty.amountXof).toBe(10_000);
  });
});

describe("the AI only sends signals", () => {
  it("verify.done records the verdict but keeps the status", () => {
    const r = transition(at("submitted"), { ...SAMPLE["verify.done"], verdict: "fail" });
    expect(r).toMatchObject({ ok: true, to: "submitted" });
    expect(r.ok && r.bounty.verdict).toBe("fail");
  });

  it("verify.done can't move a bounty that isn't submitted", () => {
    for (const s of BOUNTY_STATUSES.filter((s) => s !== "submitted")) {
      expect(transition(at(s), SAMPLE["verify.done"]).ok, s).toBe(false);
    }
  });

  it("merge with verdict pass and green CI → verified", () => {
    const r = transition(at("submitted", { verdict: "pass" }), SAMPLE["pr.merged"]);
    expect(r).toMatchObject({ ok: true, to: "verified" });
  });

  it.each([
    ["fail", true],
    ["unsure", true],
    [null, true],
    ["pass", false],
  ] as const)("merge with verdict %s and CI green=%s → on_hold for the maintainer", (verdict, ciGreen) => {
    const r = transition(at("submitted", { verdict }), { ...SAMPLE["pr.merged"], ciGreen });
    expect(r).toMatchObject({ ok: true, to: "on_hold" });
  });

  it("a new PR clears the previous verdict", () => {
    const b = run(at("claimed", { verdict: "pass" }), [SAMPLE["pr.linked"]]);
    expect(b.verdict).toBeNull();
  });

  it("a new push on a submitted PR stays submitted and clears the verdict", () => {
    const r = transition(at("submitted", { verdict: "pass" }), SAMPLE["pr.linked"]);
    expect(r).toMatchObject({ ok: true, to: "submitted", bounty: { verdict: null } });
  });
});

describe("maintainer and failure paths", () => {
  it("on_hold → /pay → verified → paid", () => {
    const b = run(at("on_hold"), [
      SAMPLE["maintainer.pay"],
      SAMPLE["payout.started"],
      SAMPLE["payout.succeeded"],
    ]);
    expect(b.status).toBe("paid");
  });

  it("/reject sends the bounty back to funded and clears the verdict", () => {
    const b = run(at("submitted", { verdict: "fail" }), [SAMPLE["maintainer.reject"]]);
    expect(b).toMatchObject({ status: "funded", verdict: null });
  });

  it("merge without 'Fixes #n': /pay from claimed → verified", () => {
    expect(transition(at("claimed"), SAMPLE["maintainer.pay"])).toMatchObject({ ok: true, to: "verified" });
  });

  it("/hold during the objection window", () => {
    expect(transition(at("verified"), SAMPLE["maintainer.hold"])).toMatchObject({ ok: true, to: "on_hold" });
  });

  it("/hold is refused once the payout is in flight", () => {
    expect(transition(at("paying"), SAMPLE["maintainer.hold"]).ok).toBe(false);
  });

  it("a failed payout is retried until it succeeds", () => {
    const b = run(at("verified"), [
      SAMPLE["payout.started"],
      SAMPLE["payout.failed"],
      { ...SAMPLE["payout.started"], attempt: 2 },
      { ...SAMPLE["payout.failed"], attempt: 2 },
      { ...SAMPLE["payout.started"], attempt: 3 },
      SAMPLE["payout.succeeded"],
    ]);
    expect(b.status).toBe("paid");
  });

  it("a failed payout never goes back to the funder", () => {
    expect(transition(at("payout_failed"), SAMPLE["bounty.cancelled"]).ok).toBe(false);
    expect(transition(at("payout_failed"), SAMPLE["maintainer.reject"]).ok).toBe(false);
  });

  it.each(["claim.expired", "claim.released"] as const)("%s frees the bounty", (type) => {
    expect(transition(at("claimed"), SAMPLE[type])).toMatchObject({ ok: true, to: "funded" });
  });

  it("an expired claim can't cancel a submitted PR", () => {
    expect(transition(at("submitted"), SAMPLE["claim.expired"]).ok).toBe(false);
  });

  it.each([
    ["unfunded", "cancelled"],
    ["funded", "refunded"],
    ["claimed", "refunded"],
  ] as const)("cancel from %s → %s", (from, to) => {
    expect(transition(at(from), SAMPLE["bounty.cancelled"])).toMatchObject({ ok: true, to });
  });
});

describe("table", () => {
  it("transition() agrees with the table for every status × event", () => {
    for (const s of BOUNTY_STATUSES) {
      for (const type of EVENT_TYPES) {
        const r = transition(at(s, { verdict: "pass" }), SAMPLE[type]);
        expect(r.ok, `${type} from ${s}`).toBe(canTransition(s, type));
        if (r.ok) expect(TRANSITIONS[s][type]).toContain(r.to);
      }
    }
  });

  it("covers every status and only targets known statuses", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...BOUNTY_STATUSES].sort());
    for (const byEvent of Object.values(TRANSITIONS)) {
      for (const targets of Object.values(byEvent)) {
        for (const t of targets ?? []) expect(BOUNTY_STATUSES).toContain(t);
      }
    }
  });

  it("bounty.created is never a transition", () => {
    for (const s of BOUNTY_STATUSES) expect(canTransition(s, "bounty.created")).toBe(false);
  });

  it("every non-terminal status can be left, and paid is reachable from it", () => {
    const reachesPaid = (start: BountyStatus): boolean => {
      const seen = new Set<BountyStatus>();
      const stack = [start];
      while (stack.length) {
        const s = stack.pop()!;
        if (s === "paid") return true;
        if (seen.has(s)) continue;
        seen.add(s);
        for (const targets of Object.values(TRANSITIONS[s])) stack.push(...(targets ?? []));
      }
      return false;
    };
    for (const s of BOUNTY_STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s))) {
      expect(reachesPaid(s), s).toBe(true);
    }
  });
});

describe("helpers", () => {
  it("isEventType", () => {
    expect(isEventType("pr.merged")).toBe(true);
    expect(isEventType("pr.closed")).toBe(false);
    expect(isEventType(42)).toBe(false);
  });

  it("assertAmount", () => {
    expect(() => assertAmount(1)).not.toThrow();
    expect(() => assertAmount(0.1 + 0.2, "x")).toThrow("x must be a positive integer");
  });
});
