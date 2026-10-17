import type { VerifyCi } from "../verifier/index.js";
import type {
  BountyLookup,
  CheckConclusion,
  CheckRunGithub,
  CheckRunOutput,
  CheckRunTarget,
  LinkedBounty,
  PrRef,
} from "./types.js";

export interface FakeCheckRun {
  id: number;
  repo: string;
  headSha: string;
  status: "in_progress" | "completed";
  conclusion: CheckConclusion | null;
  output: CheckRunOutput;
  /** Every output written, in order. */
  history: Array<{ conclusion: CheckConclusion | null; output: CheckRunOutput }>;
}

/** In-memory GitHub: records check runs; diff, head and CI are settable per PR. */
export class FakeCheckRunGithub implements CheckRunGithub {
  readonly runs: FakeCheckRun[] = [];
  diffs = new Map<number, string>();
  heads = new Map<number, string>();
  issues = new Map<number, { title: string; body: string }>();
  ci: VerifyCi = { status: "success" };
  /** Set to make a read fail (e.g. GitHub 406 on a huge diff). */
  failDiff: Error | null = null;
  /** Called before getPrDiff resolves; lets tests interleave pushes. */
  onDiff: ((prNumber: number) => Promise<void> | void) | null = null;

  async createCheckRun(t: CheckRunTarget, headSha: string, output: CheckRunOutput) {
    const run: FakeCheckRun = {
      id: this.runs.length + 1,
      repo: t.repo,
      headSha,
      status: "in_progress",
      conclusion: null,
      output,
      history: [{ conclusion: null, output }],
    };
    this.runs.push(run);
    return run.id;
  }

  async completeCheckRun(_t: CheckRunTarget, id: number, conclusion: CheckConclusion, output: CheckRunOutput) {
    const run = this.runs.find((r) => r.id === id);
    if (!run) throw new Error(`no check run ${id}`);
    Object.assign(run, { status: "completed", conclusion, output });
    run.history.push({ conclusion, output });
  }

  async getPrDiff(_t: CheckRunTarget, prNumber: number) {
    await this.onDiff?.(prNumber);
    if (this.failDiff) throw this.failDiff;
    return this.diffs.get(prNumber) ?? "";
  }

  async getPrHeadSha(_t: CheckRunTarget, prNumber: number) {
    const h = this.heads.get(prNumber);
    if (!h) throw new Error("unknown PR");
    return h;
  }

  async getCiStatus() {
    return this.ci;
  }

  async getIssue(_t: CheckRunTarget, n: number) {
    const i = this.issues.get(n);
    if (!i) throw new Error(`no issue ${n}`);
    return i;
  }
}

/** Lookup with a fixed answer per PR number. */
export class FakeBountyLookup implements BountyLookup {
  constructor(readonly byPr = new Map<number, LinkedBounty>()) {}
  async findForPr(pr: PrRef) {
    return this.byPr.get(pr.number);
  }
}
