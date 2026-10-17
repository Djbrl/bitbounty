import { randomUUID } from "node:crypto";
import type { BitnobClient } from "@bitbounty/bitnob";
import type { Bounty, BountyStatus } from "@bitbounty/core";
import { Hono } from "hono";
import { FakeCheckRunGithub, registerCheckRun, RepoBountyLookup } from "../ai/check-run/index.js";
import { FakeVerifierClient } from "../ai/verifier/index.js";
import { signBitnobPayload } from "../bitnob/signature.js";
import { bitnobWebhookRoutes } from "../bitnob/webhook.js";
import { InMemoryBountyRepo } from "../bounties/repo.js";
import {
  applyFundingPaid,
  BitnobFunderCustomers,
  BitnobRates,
  InMemoryFundingStore,
  InMemoryNgnAccountStore,
  LightningFunding,
  NgnFunding,
  type Rates,
} from "../funding/index.js";
import { GithubDispatcher } from "../github/dispatcher.js";
import { InMemoryEventStore } from "../github/event-store.js";
import { FixedCiReader, InMemoryEventBus, RecordingNotifier, registerPrHandlers } from "../github/pr/index.js";
import { signPayload } from "../github/signature.js";
import { labelFor } from "../github/status-comment/index.js";
import { githubWebhookRoutes } from "../github/webhook.js";
import { FakeGithubWriter, registerCommentWiring, syncIssue } from "../github/wiring/index.js";
import { InMemoryPayoutStore, PayoutService, type Beneficiary, type PayoutRails } from "../payouts/index.js";
import { Settlement } from "../settlement/index.js";
import { FakeBitnob } from "./fake-bitnob.js";

/**
 * I2: the whole story in one process, start to finish:
 *   /bounty → fund → /claim → PR "Fixes #1" → BitBounty check (pass) → merge → payout → paid.
 *
 * Every module is the real one (G1–G4, A1/A2, B1/B2/B4/B5, settlement), wired like `app.ts`, on an
 * empty in-memory database. GitHub is simulated with **signed webhooks** into the real receiver
 * and a fake GitHub API (comments, labels, check runs). Bitnob is a fake, or the real sandbox
 * when `bitnob` is given.
 */
export interface HappyPathOptions {
  /** Real Bitnob sandbox client. Omit for the offline fake. */
  bitnob?: BitnobClient;
  /** How the bounty is funded. Sandbox Lightning needs someone to pay the printed invoice. */
  fund?: "lightning" | "ngn";
  /** Where the developer is paid (sandbox mode needs a number Bitnob accepts). */
  beneficiary?: Beneficiary;
  amountXof?: number;
  /** Max wait for each asynchronous step (funding, payout) in sandbox mode. */
  timeoutMs?: number;
  /** Progress lines. */
  log?: (line: string) => void;
}

export interface HappyPathStep {
  name: string;
  status: BountyStatus;
  ms: number;
  detail?: string;
}

export interface HappyPathReport {
  bountyId: string;
  repo: string;
  steps: HappyPathStep[];
  /** Internal events in the order they were published. */
  events: string[];
  statusComment: string;
  labels: string[];
}

const ISSUE_BODY = [
  "The date parser crashes on `31/12/2026`.",
  "",
  "## Done when",
  "- parseDate accepts DD/MM/YYYY",
  "- a test covers 31/12/2026",
].join("\n");
const CRITERIA = ["parseDate accepts DD/MM/YYYY", "a test covers 31/12/2026"];
const DIFF = [
  "diff --git a/src/date.ts b/src/date.ts",
  "+export function parseDate(s: string) { const [d, m, y] = s.split('/'); return new Date(+y, +m - 1, +d); }",
  "diff --git a/test/date.test.ts b/test/date.test.ts",
  "+it('parses 31/12/2026', () => expect(parseDate('31/12/2026').getDate()).toBe(31));",
].join("\n");

const MAINTAINER = "fatou-maintainer";
const DEVELOPER = "awa-dev";
const INSTALLATION = 1;
const GH_SECRET = "e2e-github-secret";
const BN_SECRET = "e2e-bitnob-secret";

export class E2eError extends Error {
  constructor(
    message: string,
    readonly report: Partial<HappyPathReport>,
  ) {
    super(message);
    this.name = "E2eError";
  }
}

export async function runHappyPath(opts: HappyPathOptions = {}): Promise<HappyPathReport> {
  const sandbox = Boolean(opts.bitnob);
  const fund = opts.fund ?? (sandbox ? "ngn" : "lightning");
  const amountXof = opts.amountXof ?? (sandbox ? 300 : 10_000);
  const timeoutMs = opts.timeoutMs ?? (sandbox ? 180_000 : 5_000);
  const say = opts.log ?? (() => {});
  const quiet = { info: () => {}, warn: () => {}, error: (m: string) => say(`  ! ${m}`) };
  const run = randomUUID().slice(0, 8);
  const repoName = `bitbounty-e2e/demo-${run}`;
  const issueNumber = 1;
  const prNumber = 2;
  const headSha = `${run}`.padEnd(40, "0");

  // ---- the server, wired like app.ts, on an empty database ----
  const fake = new FakeBitnob();
  const client = opts.bitnob;
  const rates: Rates = client ? new BitnobRates(client) : fake.rates;
  const customers = new BitnobFunderCustomers(client ?? fake, (id) => `e2e-${run}-${id.replace(/\W/g, "")}@bitbounty.invalid`);

  const repo = new InMemoryBountyRepo();
  const bus = new InMemoryEventBus();
  const writer = new FakeGithubWriter();
  writer.permissions.set(MAINTAINER, "admin");
  const githubDispatcher = new GithubDispatcher();
  const bitnobDispatcher = new GithubDispatcher();
  const app = new Hono();
  const eventStore = new InMemoryEventStore();
  app.route("/", githubWebhookRoutes({ secret: GH_SECRET, store: eventStore, dispatcher: githubDispatcher, log: quiet }));
  app.route("/", bitnobWebhookRoutes({ secret: BN_SECRET, store: eventStore, dispatcher: bitnobDispatcher, log: quiet }));

  registerPrHandlers(githubDispatcher, { bounties: repo, bus, notifier: new RecordingNotifier(), ci: new FixedCiReader(true) });
  registerCommentWiring(githubDispatcher, { repo, bus, writerFor: async () => writer, baseUrl: "https://bitbounty.test", lang: "en", log: quiet });

  const checkGithub = new FakeCheckRunGithub();
  checkGithub.issues.set(issueNumber, { title: "Date parser crashes on 31/12", body: ISSUE_BODY });
  checkGithub.heads.set(prNumber, headSha);
  checkGithub.diffs.set(prNumber, DIFF);
  const checks: Promise<void>[] = [];
  registerCheckRun(githubDispatcher, {
    github: checkGithub,
    lookup: new RepoBountyLookup(repo, async () => ISSUE_BODY),
    bus,
    verifierClient: () =>
      new FakeVerifierClient({
        criteria: CRITERIA.map((text) => ({ text, met: true, evidence: "src/date.ts, test/date.test.ts" })),
        verdict: "pass",
        summary: "Both criteria are met.",
        risk_flags: [],
      }),
    runInBackground: (task) => void checks.push(task()),
    log: quiet,
  });

  const beneficiary: Beneficiary = opts.beneficiary ?? { provider: "wave", phoneE164: "+221771234567", accountName: "Awa Diop", country: "SN" };
  const settlement = new Settlement({
    repo,
    bus,
    startPayout: (req) => payouts.start(req),
    sync: async (b) => void (await syncIssue(b, { writer, repo, baseUrl: "https://bitbounty.test", lang: "en" })),
    objectionMs: 0,
    log: quiet,
  }).register();
  const payouts: PayoutService = new PayoutService({
    rails: (client ?? fake) as unknown as PayoutRails,
    store: new InMemoryPayoutStore(),
    emit: settlement.applyPayoutEvent,
    getBeneficiary: async (userId) => {
      if (userId !== `github:${DEVELOPER}`) throw new Error(`no payout account for ${userId}`);
      return beneficiary;
    },
    callbackUrl: "https://bitbounty.test/webhooks/bitnob",
    retryDelaysMs: [sandbox ? 3_000 : 0],
    log: quiet,
  });
  payouts.register(bitnobDispatcher);

  const emitFunding = applyFundingPaid(repo, bus, quiet);
  const lightning = new LightningFunding({ client: client ?? fake, store: new InMemoryFundingStore(), rates, customers, bounties: repo, emit: emitFunding, log: quiet });
  const ngn = new NgnFunding({
    client: client ?? fake,
    fundings: new InMemoryFundingStore(),
    accounts: new InMemoryNgnAccountStore(),
    rates,
    customers,
    emit: emitFunding,
    log: quiet,
  });

  // ---- helpers ----
  const steps: HappyPathStep[] = [];
  let bountyId = "";
  const t0 = Date.now();
  const report = (): Partial<HappyPathReport> => ({ bountyId, repo: repoName, steps, events: bus.published.map((e) => e.type) });
  const bounty = async (): Promise<Bounty> => {
    const b = await repo.findByIssue(repoName, issueNumber);
    if (!b) throw new E2eError("no bounty on the issue", report());
    bountyId = b.id;
    return b;
  };
  const expectStatus = async (name: string, want: BountyStatus, detail?: string) => {
    const b = await bounty();
    steps.push({ name, status: b.status, ms: Date.now() - t0, detail });
    say(`  ${b.status === want ? "✓" : "✗"} ${name}: ${b.status}${detail ? ` (${detail})` : ""}`);
    if (b.status !== want) throw new E2eError(`${name}: expected ${want}, got ${b.status}`, report());
  };
  const waitFor = async (what: string, until: () => Promise<boolean>, tick: () => Promise<unknown> = async () => {}) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      await tick();
      if (await until()) return;
      if (Date.now() > end) throw new E2eError(`timed out waiting for ${what}`, report());
      await new Promise((r) => setTimeout(r, sandbox ? 3_000 : 5));
    }
  };
  let delivery = 0;
  const github = async (event: string, payload: object) => {
    const body = JSON.stringify({ ...payload, repository: { full_name: repoName }, installation: { id: INSTALLATION } });
    const res = await app.request("/webhooks/github", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": `${run}-${++delivery}`,
        "x-hub-signature-256": signPayload(GH_SECRET, body),
      },
    });
    if (res.status !== 200) throw new E2eError(`GitHub webhook ${event} answered ${res.status}: ${await res.text()}`, report());
  };
  const comment = (login: string, text: string) =>
    github("issue_comment", {
      action: "created",
      issue: { number: issueNumber, title: "Date parser crashes on 31/12", body: ISSUE_BODY, state: "open" },
      comment: { id: ++delivery, body: text, user: { login, type: "User" }, author_association: login === MAINTAINER ? "OWNER" : "NONE" },
    });
  const pullRequest = (action: string, merged: boolean) =>
    github("pull_request", {
      action,
      number: prNumber,
      pull_request: {
        number: prNumber,
        title: "Fix date parsing for DD/MM/YYYY",
        body: `Fixes #${issueNumber}`,
        state: merged ? "closed" : "open",
        merged,
        merge_commit_sha: merged ? headSha.replace(/0/g, "1") : null,
        merged_at: merged ? new Date().toISOString() : null,
        merged_by: merged ? { login: MAINTAINER } : null,
        user: { login: DEVELOPER },
        head: { sha: headSha, repo: { full_name: repoName } },
      },
    });

  // ---- the story ----
  say(`run ${run} on ${repoName} (${sandbox ? "Bitnob sandbox" : "offline fakes"}, funding: ${fund})`);

  await comment(MAINTAINER, `/bounty ${amountXof}`);
  await expectStatus("maintainer posts /bounty", "unfunded", `${amountXof} FCFA`);

  if (fund === "lightning") {
    const f = await lightning.invoice({ bountyId, funderId: `github:${MAINTAINER}` });
    if (!sandbox) fake.payInvoice(f.bitnobRef);
    else say(`  → pay this invoice (${f.sourceAmount} sats) from a sandbox wallet:\n    ${f.paymentRequest}`);
    await waitFor("the Lightning invoice to be paid", async () => (await bounty()).status !== "unfunded", () => lightning.check(f.id));
    await expectStatus("funder pays the Lightning invoice", "funded", `${f.sourceAmount} sats`);
  } else {
    const { funding, account } = await ngn.account(
      { bountyId, amountXof, funderId: `lagos-${run}` },
      { first_name: "Ada", last_name: "Okafor", phone_number: "+2348012345678", date_of_birth: "1990-01-01", id_type: "bvn", id_number: "22222222222" },
    );
    const done = await ngn.simulateUntilFunded(funding.id);
    say(`  … naira account ${account.accountNumber}: ${done.state}, received ₦${done.receivedKobo / 100}${done.lastError ? `, error: ${done.lastError}` : ""}`);
    if (done.state === "collecting" && done.lastError) throw new E2eError(`naira funding: ${done.lastError}`, report());
    // An order still pending at Bitnob is settled by resume() (what the server runs on its timer).
    await waitFor("funding.paid", async () => (await bounty()).status !== "unfunded", () => ngn.resume());
    await expectStatus("Lagos funder transfers naira (NGN → BTC)", "funded", `₦${account.requiredNaira}, ${done.state}`);
  }

  await comment(DEVELOPER, "/claim");
  await expectStatus("developer posts /claim", "claimed");

  await pullRequest("opened", false);
  await expectStatus("developer opens PR \"Fixes #1\"", "submitted");
  await Promise.all(checks);
  const check = checkGithub.runs.at(-1);
  const verdict = (await bounty()).verdict;
  await expectStatus("BitBounty check runs", "submitted", `check ${check?.conclusion ?? "missing"}, verdict ${verdict}`);
  if (check?.conclusion !== "success" || verdict !== "pass") {
    throw new E2eError(`verification: check ${check?.conclusion}, verdict ${verdict} (expected success / pass)`, report());
  }

  await pullRequest("closed", true);
  const merged = await bounty();
  steps.push({ name: "maintainer merges the PR", status: merged.status, ms: Date.now() - t0 });
  say(`  ✓ maintainer merges the PR: ${merged.status}`);
  if (!["verified", "paying", "paid"].includes(merged.status)) {
    throw new E2eError(`merge: expected verified, got ${merged.status}`, report());
  }

  // Payout: the fake answers `processing`, then Bitnob's success webhook arrives (signed, through B5).
  // In the sandbox we poll Bitnob, which is also the fallback when webhooks don't come.
  await waitFor(
    "the payout",
    async () => (await bounty()).status === "paid" || (await bounty()).status === "payout_failed",
    async () => {
      if (sandbox) return payouts.poll();
      for (const p of fake.payouts.values()) {
        if (p.status !== "processing") continue;
        p.status = "success";
        const body = JSON.stringify({
          event: "payouts.withdrawal.success",
          event_id: `${run}-${p.id}`,
          data: { id: p.id, quote_id: p.quote_id, reference: p.reference, status: "success" },
        });
        await app.request("/webhooks/bitnob", { method: "POST", body, headers: { "x-bitnob-signature": signBitnobPayload(BN_SECRET, body) } });
      }
    },
  );
  await expectStatus("developer is paid on mobile money", "paid", `${amountXof} FCFA to ${beneficiary.provider}`);

  const final = await bounty();
  const statusComment = final.statusCommentId ? writer.comments.get(final.statusCommentId)?.body ?? "" : "";
  const labels = await writer.listIssueLabels(repoName, issueNumber);
  if (!labels.includes(labelFor("paid").name)) {
    throw new E2eError(`status label is ${labels.join(", ")}, expected ${labelFor("paid").name}`, report());
  }
  return { ...(report() as HappyPathReport), statusComment, labels };
}

/** The order the internal events must come in for a clean run. */
export const HAPPY_PATH_EVENTS = [
  "bounty.created",
  "funding.paid",
  "claim.created",
  "pr.linked",
  "verify.done",
  "pr.merged",
  "payout.started",
  "payout.succeeded",
] as const;
