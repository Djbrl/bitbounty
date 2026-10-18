import type { GithubDispatcher } from "../../github/dispatcher.js";
import { createVerifierClient, verify, type VerifierClient, type VerifyOptions } from "../verifier/index.js";
import { conclusionFor, renderError, renderInProgress, renderReport, renderSuperseded } from "./summary.js";
import type { BountyLookup, CheckRunGithub, EventBus, LinkedBounty, PrRef } from "./types.js";

export const CHECK_ACTIONS = ["opened", "synchronize", "reopened"] as const;

export interface CheckRunDeps {
  github: CheckRunGithub;
  lookup: BountyLookup;
  bus: EventBus;
  /** Defaults to `createVerifierClient()`: Claude if ANTHROPIC_API_KEY is set, else the offline fake. */
  verifierClient?: () => VerifierClient;
  verifyOptions?: Omit<VerifyOptions, "client">;
  /**
   * Runs the slow part (diff + Claude) after the webhook has answered: GitHub gives a
   * webhook 10 s, Claude can take longer. Tests pass a collector to await it.
   */
  runInBackground?: (task: () => Promise<void>) => void;
  now?: () => Date;
  log?: Pick<Console, "info" | "warn" | "error">;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

/** The PR fields A2 uses, or null when the payload isn't usable. */
export function parsePrPayload(payload: unknown): { action: string; pr: PrRef } | null {
  if (!isObj(payload) || !isObj(payload.pull_request) || !isObj(payload.repository)) return null;
  const p = payload.pull_request;
  const repo = payload.repository.full_name;
  const head = isObj(p.head) ? p.head : null;
  const installationId = isObj(payload.installation) ? payload.installation.id : null;
  const author = isObj(p.user) ? p.user.login : null;
  if (
    typeof payload.action !== "string" ||
    typeof repo !== "string" ||
    typeof p.number !== "number" ||
    typeof head?.sha !== "string" ||
    typeof installationId !== "number"
  ) {
    return null;
  }
  return {
    action: payload.action,
    pr: {
      repo,
      installationId,
      number: p.number,
      headSha: head.sha,
      title: typeof p.title === "string" ? p.title : "",
      body: typeof p.body === "string" ? p.body : null,
      authorLogin: typeof author === "string" ? author : "",
    },
  };
}

/**
 * A2: on every push to a PR linked to a funded bounty, publish a "BitBounty verification"
 * check run on the head commit, then emit `verify.done`. Advice only: it never moves
 * the bounty or the money.
 */
export class CheckRunPublisher {
  /** Latest head SHA seen per PR, so a fast push makes older runs stand down. */
  private latest = new Map<string, string>();
  private log: Pick<Console, "info" | "warn" | "error">;

  constructor(private deps: CheckRunDeps) {
    this.log = deps.log ?? console;
  }

  register(dispatcher: GithubDispatcher): this {
    for (const action of CHECK_ACTIONS) {
      dispatcher.on(`pull_request.${action}`, (e) => this.onPullRequest(e.payload));
    }
    return this;
  }

  /** Fast part, awaited by the webhook: lookup + create the in-progress check. */
  async onPullRequest(payload: unknown): Promise<void> {
    const parsed = parsePrPayload(payload);
    if (!parsed || !(CHECK_ACTIONS as readonly string[]).includes(parsed.action)) return;
    const { pr } = parsed;
    const linked = await this.deps.lookup.findForPr(pr);
    if (!linked) return;

    this.latest.set(key(pr), pr.headSha);
    const checkRunId = await this.deps.github.createCheckRun(pr, pr.headSha, renderInProgress(linked.issueNumber));
    this.log.info(`[check-run] ${pr.repo}#${pr.number} ${pr.headSha.slice(0, 7)}: check ${checkRunId} in progress`);
    const task = () => this.finish(pr, linked, checkRunId);
    if (this.deps.runInBackground) this.deps.runInBackground(task);
    else void task();
  }

  /** Slow part: diff + CI + verify(), then complete the check and emit `verify.done`. Never throws. */
  async finish(pr: PrRef, linked: LinkedBounty, checkRunId: number): Promise<void> {
    const { github, bus } = this.deps;
    try {
      const before = this.newerInMemory(pr);
      if (before) return await this.supersede(pr, checkRunId, before);

      const [diff, ci] = await Promise.all([github.getPrDiff(pr, pr.number), github.getCiStatus(pr, pr.headSha)]);
      const client = this.deps.verifierClient?.() ?? createVerifierClient();
      const report = await verify(
        { issue: linked.issue, criteria: linked.criteria, diff, ci },
        { ...this.deps.verifyOptions, client },
      );

      const newer = await this.newerHead(pr);
      if (newer) return await this.supersede(pr, checkRunId, newer);

      const conclusion = conclusionFor(report.verdict);
      await github.completeCheckRun(
        pr,
        checkRunId,
        conclusion,
        renderReport(report, {
          bountyId: linked.bountyId,
          issueNumber: linked.issueNumber,
          headSha: pr.headSha,
          ci,
          verifierName: client.name,
        }),
      );
      await bus.publish({
        type: "verify.done",
        bountyId: linked.bountyId,
        occurredAt: (this.deps.now?.() ?? new Date()).toISOString(),
        prNumber: pr.number,
        headSha: pr.headSha,
        verdict: report.verdict,
      });
      this.log.info(`[check-run] ${pr.repo}#${pr.number} ${pr.headSha.slice(0, 7)}: ${report.verdict} → ${conclusion}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`[check-run] ${pr.repo}#${pr.number} ${pr.headSha.slice(0, 7)} failed: ${msg.slice(0, 200)}`);
      try {
        await github.completeCheckRun(pr, checkRunId, "neutral", renderError(msg));
      } catch (err2) {
        this.log.error(`[check-run] could not close check ${checkRunId}: ${String(err2).slice(0, 200)}`);
      }
    }
  }

  private newerInMemory(pr: PrRef): string | undefined {
    const seen = this.latest.get(key(pr));
    return seen && seen !== pr.headSha ? seen : undefined;
  }

  /** In-memory first (same process), then GitHub (another instance, or a missed webhook). */
  private async newerHead(pr: PrRef): Promise<string | undefined> {
    const mem = this.newerInMemory(pr);
    if (mem) return mem;
    try {
      const head = await this.deps.github.getPrHeadSha(pr, pr.number);
      return head !== pr.headSha ? head : undefined;
    } catch {
      return undefined;
    }
  }

  private async supersede(pr: PrRef, checkRunId: number, newer: string): Promise<void> {
    await this.deps.github.completeCheckRun(pr, checkRunId, "skipped", renderSuperseded(newer));
    this.log.info(`[check-run] ${pr.repo}#${pr.number} ${pr.headSha.slice(0, 7)}: superseded by ${newer.slice(0, 7)}`);
  }
}

function key(pr: PrRef): string {
  return `${pr.repo.toLowerCase()}#${pr.number}`;
}

export function registerCheckRun(dispatcher: GithubDispatcher, deps: CheckRunDeps): CheckRunPublisher {
  return new CheckRunPublisher(deps).register(dispatcher);
}
