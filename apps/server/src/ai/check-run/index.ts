import { createGithubApp, readGithubAppConfig, type GithubAppEnv } from "../../github/app-client.js";
import type { ClientFor, RequestClient } from "../../github/pr/octokit.js";
import type { CheckRunDeps } from "./handler.js";
import { FirstMatchLookup, IssueDemoLookup, RepoBountyLookup } from "./lookup.js";
import { OctokitCheckRunGithub } from "./octokit.js";
import type { BountyLookup, BountyRepo, EventBus } from "./types.js";

export { CheckRunPublisher, CHECK_ACTIONS, parsePrPayload, registerCheckRun, type CheckRunDeps } from "./handler.js";
export { conclusionFor, renderReport, sanitize, summarizeCi } from "./summary.js";
export { criteriaFromIssueBody, FirstMatchLookup, IssueDemoLookup, RepoBountyLookup, VERIFIABLE_STATUSES } from "./lookup.js";
export { OctokitCheckRunGithub } from "./octokit.js";
export { FakeBountyLookup, FakeCheckRunGithub } from "./fakes.js";
export * from "./types.js";

export interface CheckRunEnv extends GithubAppEnv {
  /** `issue`: demo mode, any issue a PR closes counts as funded (criteria from its "Done when"). */
  CHECK_RUN_DEMO_LOOKUP?: string;
}

/**
 * Production wiring, or null when the GitHub App env is missing (nothing to write to).
 * The verifier is Claude when ANTHROPIC_API_KEY is set, else A1's offline fake.
 */
export function defaultCheckRunDeps(
  bounties: Pick<BountyRepo, "findByIssue">,
  bus: EventBus,
  env: CheckRunEnv = process.env,
): CheckRunDeps | null {
  if (!env.GITHUB_APP_ID || !env.GITHUB_PRIVATE_KEY || !env.GITHUB_WEBHOOK_SECRET) return null;
  const gh = createGithubApp(readGithubAppConfig(env));
  const clientFor: ClientFor = async (id) => (await gh.getInstallationOctokit(id)) as unknown as RequestClient;
  const github = new OctokitCheckRunGithub(clientFor);
  const lookups: BountyLookup[] = [
    new RepoBountyLookup(bounties, async (pr, n) => (await github.getIssue(pr, n)).body),
  ];
  if (env.CHECK_RUN_DEMO_LOOKUP === "issue") lookups.push(new IssueDemoLookup(github));
  return { github, lookup: new FirstMatchLookup(lookups), bus };
}
