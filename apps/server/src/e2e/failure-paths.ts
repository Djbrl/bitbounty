import { randomUUID } from "node:crypto";
import type { Bounty, BountyStatus } from "@bitbounty/core";
import { Hono } from "hono";
import { FakeCheckRunGithub, registerCheckRun, RepoBountyLookup } from "../ai/check-run/index.js";
import { FakeVerifierClient } from "../ai/verifier/index.js";
import { ActivityLog, readApiRoutes } from "../api/index.js";
import { signBitnobPayload } from "../bitnob/signature.js";
import { bitnobWebhookRoutes } from "../bitnob/webhook.js";
import { InMemoryBountyRepo } from "../bounties/repo.js";
import { applyFundingPaid, BitnobFunderCustomers, InMemoryFundingStore, LightningFunding } from "../funding/index.js";
import { ClaimTimers, FakeAssigner, InMemoryClaimScheduler } from "../github/claims/index.js";
import { GithubDispatcher } from "../github/dispatcher.js";
import { InMemoryEventStore } from "../github/event-store.js";
import { FixedCiReader, InMemoryEventBus, RecordingNotifier, registerPrHandlers } from "../github/pr/index.js";
import { signPayload } from "../github/signature.js";
import { labelFor } from "../github/status-comment/index.js";
import { githubWebhookRoutes } from "../github/webhook.js";
import { FakeGithubWriter, registerCommentWiring, syncIssue } from "../github/wiring/index.js";
import { InMemoryPayoutStore, PayoutService, type LightningRails } from "../payouts/index.js";
import { Settlement, statusExtras } from "../settlement/index.js";
import { FakeBitnob } from "./fake-bitnob.js";

/**
 * I3: the two failures the demo shows, played with the real modules (like I2's happy path):
 *  - **payout retry**: Bitnob reports the first payout `withdrawal.expired` → the bounty goes
 *    `payout_failed` (status comment says why and that we retry) → B6 retries with a new invoice →
 *    `paying` → Bitnob success → `paid`;
 *  - **claim expiry**: a developer claims and never opens a PR → the claim timer (G5) fires →
 *    `claim.expired`, back to `funded`, the issue is unassigned and the bot posts a note → someone
 *    else can `/claim`.
 * At each step it checks what GitHub shows (status comment, label, assignee, bot note) and what the
 * web shows (I1's read API: status, claims, payout, timeline). `serve()` exposes that API so the
 * web pages can display the result.
 */

export interface Step {
  name: string;
  status: BountyStatus;
  /** What the GitHub status comment says (its status line). */
  github: string;
  /** The whole status comment at that step. */
  comment: string;
  ok: boolean;
}

export interface ScenarioReport {
  scenario: "payout-retry" | "claim-expiry";
  bountyId: string;
  repo: string;
  steps: Step[];
  events: string[];
  /** Final status comment body on the issue. */
  statusComment: string;
  labels: string[];
  /** Notes the bot posted besides the status comment (e.g. the claim expiry note). */
  notes: string[];
  /** The bounty page data (`GET /api/bounties/:id`) at the end. */
  web: { status: string; timeline: string[]; claims: number; payout: { status: string; attempts: number } | null };
}

export class ScenarioError extends Error {
  constructor(
    message: string,
    readonly steps: Step[],
  ) {
    super(message);
    this.name = "ScenarioError";
  }
}

const MAINTAINER = "fatou-maintainer";
const DEVELOPER = "awa-dev";
const SECOND_DEVELOPER = "moussa-dev";
const GH_SECRET = "i3-github-secret";
const BN_SECRET = "i3-bitnob-secret";
const ISSUE_BODY = ["Payout quotes round XOF wrong.", "", "## Done when", "- amounts are whole FCFA", "- a test covers 12 345"].join("\n");
const CRITERIA = ["amounts are whole FCFA", "a test covers 12 345"];

export interface WorldOptions {
  /** Claim length (G5). Short so the expiry happens during the run. */
  claimTtlMs?: number;
  /** Wait before B6 retries a failed payout. Long enough to see `payout_failed`. */
  retryDelayMs?: number;
  log?: (line: string) => void;
}

/** One server, wired like app.ts (+ G5 claim timers), shared by the scenarios so the web shows both. */
export class FailureWorld {
  readonly repo = new InMemoryBountyRepo();
  readonly bus = new InMemoryEventBus();
  readonly writer = new FakeGithubWriter();
  readonly assigner = new FakeAssigner();
  readonly bitnob = new FakeBitnob();
  readonly payoutStore = new InMemoryPayoutStore();
  readonly fundingStore = new InMemoryFundingStore();
  readonly activity: ActivityLog;
  readonly app = new Hono();
  readonly claims: ClaimTimers;
  private readonly checkGithub = new FakeCheckRunGithub();
  private readonly checks: Promise<void>[] = [];
  private readonly lightning: LightningFunding;
  readonly payouts: PayoutService;
  private delivery = 0;
  private readonly baseUrl = "https://bitbounty.test";

  constructor(readonly opts: WorldOptions = {}) {
    const quiet = { info: () => {}, warn: () => {}, error: (m: string) => opts.log?.(`  ! ${m}`) };
    this.writer.permissions.set(MAINTAINER, "admin");
    this.activity = new ActivityLog(this.repo).attach(this.bus);
    const github = new GithubDispatcher();
    const bitnobDispatcher = new GithubDispatcher();
    const store = new InMemoryEventStore();
    this.app.route("/", githubWebhookRoutes({ secret: GH_SECRET, store, dispatcher: github, log: quiet }));
    this.app.route("/", bitnobWebhookRoutes({ secret: BN_SECRET, store, dispatcher: bitnobDispatcher, log: quiet }));

    const ghForRepo = async () => ({ writer: this.writer, assigner: this.assigner });
    const ttlMs = opts.claimTtlMs ?? 200;
    const claims: ClaimTimers = new ClaimTimers({
      repo: this.repo,
      bus: this.bus,
      scheduler: new InMemoryClaimScheduler({ pending: () => claims.pending(), sweepMs: Math.max(50, ttlMs) }),
      github: ghForRepo,
      ttlMs,
      baseUrl: this.baseUrl,
      lang: "en",
      log: quiet,
    });
    this.claims = claims;
    registerPrHandlers(github, { bounties: this.repo, bus: this.bus, notifier: new RecordingNotifier(), ci: new FixedCiReader(true) });
    registerCommentWiring(github, {
      repo: this.repo,
      bus: this.bus,
      writerFor: async () => this.writer,
      baseUrl: this.baseUrl,
      lang: "en",
      claimTtlMs: ttlMs,
      claims,
      log: quiet,
    });
    registerCheckRun(github, {
      github: this.checkGithub,
      lookup: new RepoBountyLookup(this.repo, async () => ISSUE_BODY),
      bus: this.bus,
      verifierClient: () =>
        new FakeVerifierClient({
          criteria: CRITERIA.map((text) => ({ text, met: true, evidence: "src/xof.ts, test/xof.test.ts" })),
          verdict: "pass",
          summary: "Both criteria are met.",
          risk_flags: [],
        }),
      runInBackground: (task) => void this.checks.push(task()),
      log: quiet,
    });

    const sync = async (b: Bounty) => {
      const extras = await statusExtras(b, { repo: this.repo, payouts: this.payoutStore });
      await syncIssue(b, { writer: this.writer, repo: this.repo, baseUrl: this.baseUrl, lang: "en", extras });
    };
    const settlement = new Settlement({ repo: this.repo, bus: this.bus, startPayout: (req) => this.payouts.start(req), sync, objectionMs: 0, log: quiet }).register();
    this.payouts = new PayoutService({
      rails: this.bitnob as LightningRails,
      resolver: this.bitnob.lnurl,
      rates: this.bitnob.rates,
      store: this.payoutStore,
      emit: settlement.applyPayoutEvent,
      getPayee: async () => ({ lightningAddress: "awa@blink.sv" }),
      retryDelaysMs: [opts.retryDelayMs ?? 300],
      log: quiet,
    });
    this.payouts.register(bitnobDispatcher);
    this.lightning = new LightningFunding({
      client: this.bitnob,
      store: this.fundingStore,
      rates: this.bitnob.rates,
      customers: new BitnobFunderCustomers(this.bitnob, (id) => `i3-${id.replace(/\W/g, "")}@bitbounty.invalid`),
      bounties: this.repo,
      emit: applyFundingPaid(this.repo, this.bus, quiet),
      log: quiet,
    });
    this.app.route("/", readApiRoutes({ repo: this.repo, activity: this.activity, fundings: this.fundingStore, payouts: this.payoutStore }));
  }

  async start() {
    await this.claims.start();
  }

  stop() {
    this.claims.stop();
  }

  // ---- GitHub, as signed webhooks into the real receiver ----
  private async github(repo: string, event: string, payload: object) {
    const body = JSON.stringify({ ...payload, repository: { full_name: repo }, installation: { id: 1 } });
    const res = await this.app.request("/webhooks/github", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": `i3-${randomUUID()}`,
        "x-hub-signature-256": signPayload(GH_SECRET, body),
      },
    });
    if (res.status !== 200) throw new Error(`GitHub webhook ${event} answered ${res.status}`);
  }

  comment(repo: string, issue: number, login: string, text: string) {
    return this.github(repo, "issue_comment", {
      action: "created",
      issue: { number: issue, title: "XOF rounding in payout quotes", body: ISSUE_BODY, state: "open" },
      comment: { id: ++this.delivery, body: text, user: { login, type: "User" }, author_association: login === MAINTAINER ? "OWNER" : "NONE" },
    });
  }

  async pullRequest(repo: string, issue: number, pr: number, action: "opened" | "closed", merged: boolean) {
    const headSha = `${pr}`.padEnd(40, "a");
    this.checkGithub.issues.set(issue, { title: "XOF rounding in payout quotes", body: ISSUE_BODY });
    this.checkGithub.heads.set(pr, headSha);
    this.checkGithub.diffs.set(pr, "diff --git a/src/xof.ts b/src/xof.ts\n+export const round = (n: number) => Math.round(n);\n");
    await this.github(repo, "pull_request", {
      action,
      number: pr,
      pull_request: {
        number: pr,
        title: "Round XOF to whole francs",
        body: `Fixes #${issue}`,
        state: merged ? "closed" : "open",
        merged,
        merge_commit_sha: merged ? headSha.replace(/a/g, "b") : null,
        merged_at: merged ? new Date().toISOString() : null,
        merged_by: merged ? { login: MAINTAINER } : null,
        user: { login: DEVELOPER },
        head: { sha: headSha, repo: { full_name: repo } },
      },
    });
    await Promise.all(this.checks.splice(0));
  }

  async fund(bountyId: string) {
    const f = await this.lightning.invoice({ bountyId, funderId: `github:${MAINTAINER}` });
    this.bitnob.payInvoice(f.bitnobRef);
    await this.lightning.check(f.id);
  }

  /** Lightning payments Bitnob is sending (B6). `paying` can show before the pay call, so wait for this. */
  processingPayouts(): number {
    return [...this.bitnob.lnPayments.values()].filter((p) => p.status === "pending").length;
  }

  /** A Bitnob webhook for every Lightning payment still pending at the fake (applied like a poll result). */
  async bitnobPayouts(outcome: "success" | "expired") {
    for (const [reference, p] of this.bitnob.lnPayments) {
      if (p.status !== "pending") continue;
      if (outcome === "success") this.bitnob.settleLightning(reference, "paid");
      else p.status = "expired";
      const event = outcome === "success" ? "lightning.payment.success" : "lightning.payment.expired";
      const body = JSON.stringify({ event, event_id: `i3-${p.id}-${outcome}`, data: { id: p.id, reference, status: outcome } });
      const res = await this.app.request("/webhooks/bitnob", { method: "POST", body, headers: { "x-bitnob-signature": signBitnobPayload(BN_SECRET, body) } });
      if (res.status !== 200) throw new Error(`Bitnob webhook answered ${res.status}`);
    }
  }

  // ---- what people see ----
  async statusComment(b: Bounty): Promise<string> {
    const fresh = (await this.repo.findById(b.id)) ?? b;
    return fresh.statusCommentId ? (this.writer.comments.get(fresh.statusCommentId)?.body ?? "") : "";
  }

  notes(repo: string, issue: number, statusCommentId: number | null): string[] {
    return [...this.writer.comments.entries()]
      .filter(([id, c]) => c.repo === repo && c.issueNumber === issue && id !== statusCommentId && c.body.startsWith("⏰"))
      .map(([, c]) => c.body);
  }

  async web(bountyId: string): Promise<ScenarioReport["web"]> {
    const res = await this.app.request(`/api/bounties/${bountyId}`);
    const d = (await res.json()) as { status: string; timeline: { type: string }[]; claims: unknown[]; payout: { status: string; attempts: number } | null };
    return { status: d.status, timeline: d.timeline.map((e) => e.type), claims: d.claims.length, payout: d.payout ? { status: d.payout.status, attempts: d.payout.attempts } : null };
  }

  /** The read API on a port, so the web (I1, BITBOUNTY_API_URL) shows the bounties of the scenarios. */
  serve(port: number) {
    return import("@hono/node-server").then(({ serve }) => serve({ fetch: this.app.fetch, port }));
  }
}

/** First line of the status comment after the marker: the status pill. */
export function statusLine(body: string): string {
  return (body.split("\n").find((l) => l.trim() && !l.startsWith("<!--")) ?? "").trim();
}

async function scenario(
  world: FailureWorld,
  name: ScenarioReport["scenario"],
  issue: number,
  play: (ctx: {
    repo: string;
    expect: (step: string, want: BountyStatus, github: (comment: string) => boolean) => Promise<Bounty>;
    bounty: () => Promise<Bounty>;
    waitFor: (what: string, until: () => Promise<boolean>, tick?: () => Promise<unknown>) => Promise<void>;
  }) => Promise<void>,
): Promise<ScenarioReport> {
  const repo = `bitbounty-demo/${name}-${randomUUID().slice(0, 6)}`;
  const steps: Step[] = [];
  const say = world.opts.log ?? (() => {});
  const bounty = async () => {
    const b = await world.repo.findByIssue(repo, issue);
    if (!b) throw new ScenarioError("no bounty on the issue", steps);
    return b;
  };
  const expect = async (step: string, want: BountyStatus, github: (comment: string) => boolean) => {
    const b = await bounty();
    const comment = await world.statusComment(b);
    const ok = b.status === want && github(comment);
    steps.push({ name: step, status: b.status, github: statusLine(comment), comment, ok });
    say(`  ${ok ? "✓" : "✗"} ${step}: ${b.status} · GitHub: ${statusLine(comment)}`);
    if (!ok) throw new ScenarioError(`${step}: expected ${want} and a matching status comment, got ${b.status}\n${comment}`, steps);
    return b;
  };
  const waitFor = async (what: string, until: () => Promise<boolean>, tick: () => Promise<unknown> = async () => {}) => {
    // Long enough for the configured claim length and payout retry (slow when watched on a screen).
    const end = Date.now() + Math.max(5_000, 3 * (world.opts.claimTtlMs ?? 200) + 3 * (world.opts.retryDelayMs ?? 300));
    for (;;) {
      await tick();
      if (await until()) return;
      if (Date.now() > end) throw new ScenarioError(`timed out waiting for ${what}`, steps);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const firstEvent = world.bus.published.length;
  say(`${name} on ${repo}#${issue}`);
  await play({ repo, expect, bounty, waitFor });
  const b = await bounty();
  return {
    scenario: name,
    bountyId: b.id,
    repo,
    steps,
    events: world.bus.published.slice(firstEvent).filter((e) => e.bountyId === b.id).map((e) => e.type),
    statusComment: await world.statusComment(b),
    labels: await world.writer.listIssueLabels(repo, issue),
    notes: world.notes(repo, issue, b.statusCommentId),
    web: await world.web(b.id),
  };
}

/** A payout Bitnob reports expired, retried with a new invoice, then paid. */
export function payoutRetry(world: FailureWorld): Promise<ScenarioReport> {
  return scenario(world, "payout-retry", 7, async ({ repo, expect, bounty, waitFor }) => {
    await world.comment(repo, 7, MAINTAINER, "/bounty 12000");
    const b = await expect("maintainer posts /bounty 12000", "unfunded", (c) => c.includes("Waiting for funding"));
    await world.fund(b.id);
    await expect("funded over Lightning", "funded", (c) => c.includes("Funded"));
    await world.comment(repo, 7, DEVELOPER, "/claim");
    await expect("developer claims", "claimed", (c) => c.includes(`@${DEVELOPER}`));
    await world.pullRequest(repo, 7, 21, "opened", false);
    await expect("PR opened, check passes", "submitted", (c) => c.includes("#21"));
    await world.pullRequest(repo, 7, 21, "closed", true);
    await waitFor("the first payout attempt", async () => (await bounty()).status === "paying" && world.processingPayouts() === 1);
    await expect("merged → payout attempt 1", "paying", (c) => c.includes("Paying"));

    await world.bitnobPayouts("expired");
    await expect(
      "Bitnob reports attempt 1 expired → payout failed, retry announced",
      "payout_failed",
      (c) => c.includes("Payout failed") && c.includes("didn't go through") && c.includes("retry automatically") && c.includes("expired"),
    );
    await waitFor("the retry", async () => (await world.payoutStore.getByBounty(b.id))?.attempts === 2 && (await bounty()).status === "paying" && world.processingPayouts() === 1);
    await expect("B6 retries with a new invoice (attempt 2)", "paying", (c) => c.includes("Paying"));

    await world.bitnobPayouts("success");
    await waitFor("the payout", async () => (await bounty()).status === "paid");
    await expect("attempt 2 succeeds → paid", "paid", (c) => c.includes("Paid") && c.includes("/r/"));
  });
}

/** A claim nobody follows with a PR: the timer releases it, someone else can claim. */
export function claimExpiry(world: FailureWorld): Promise<ScenarioReport> {
  return scenario(world, "claim-expiry", 3, async ({ repo, expect, bounty, waitFor }) => {
    await world.comment(repo, 3, MAINTAINER, "/bounty 7500");
    const b = await expect("maintainer posts /bounty 7500", "unfunded", (c) => c.includes("Waiting for funding"));
    await world.fund(b.id);
    await expect("funded over Lightning", "funded", (c) => c.includes("Funded"));
    await world.comment(repo, 3, DEVELOPER, "/claim");
    await expect("developer claims (and is assigned)", "claimed", (c) => c.includes(`@${DEVELOPER}`));
    if (!world.assigner.of(repo, 3).includes(DEVELOPER)) throw new ScenarioError(`@${DEVELOPER} wasn't assigned`, []);
    await waitFor("the claim to expire", async () => (await bounty()).status === "funded");
    await expect("no PR before the deadline → claim expired", "funded", (c) => c.includes("Funded") && !c.includes(`@${DEVELOPER} is on it`));
    if (world.assigner.of(repo, 3).includes(DEVELOPER)) throw new ScenarioError(`@${DEVELOPER} is still assigned after the expiry`, []);
    if (!world.notes(repo, 3, (await bounty()).statusCommentId).some((n) => n.includes("expired"))) {
      throw new ScenarioError("the bot didn't post the expiry note", []);
    }
    // The demo keeps serving afterwards: stop the timers so this second claim stays on screen.
    world.stop();
    await world.comment(repo, 3, SECOND_DEVELOPER, "/claim");
    await expect("another developer can claim it", "claimed", (c) => c.includes(`@${SECOND_DEVELOPER}`));
  });
}

/** Both scenarios on one world, with the checks the issue asks for. Throws on the first mismatch. */
export async function runFailurePaths(opts: WorldOptions = {}) {
  const world = new FailureWorld(opts);
  await world.start();
  try {
    const payout = await payoutRetry(world);
    const claim = await claimExpiry(world);
    return { world, payout, claim };
  } catch (err) {
    world.stop();
    throw err;
  }
}

export const PAYOUT_RETRY_EVENTS = ["payout.started", "payout.failed", "payout.started", "payout.succeeded"];
export { labelFor };
