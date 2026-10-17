import { createGithubApp, readGithubAppConfig, type GithubAppEnv } from "../app-client.js";
import { ConsoleNotifier, FixedCiReader, InMemoryBountyRepo } from "./fakes.js";
import { OctokitCiReader, OctokitNotifier, type ClientFor, type RequestClient } from "./octokit.js";
import type { BountyRepo, EventBus, PrDeps } from "./ports.js";

export { linkedIssues, type IssueRef, type LinkedIssues } from "./linked-issues.js";
export { parsePullRequestPayload, type PullRequestPayload } from "./payload.js";
export { handlePullRequest, registerPrHandlers, type PrOutcome, type PrResult, type SkipReason } from "./handlers.js";
export { missingLinkMessage, notClaimantMessage, unclaimedMessage } from "./messages.js";
export {
  ConsoleNotifier,
  FixedCiReader,
  InMemoryBountyRepo,
  InMemoryEventBus,
  RecordingNotifier,
} from "./fakes.js";
export { DrizzleBountyRepo } from "./drizzle-bounty-repo.js";
export { BITBOUNTY_CHECK_NAME, OctokitCiReader, OctokitNotifier } from "./octokit.js";
export type * from "./ports.js";

/**
 * Production wiring: Octokit adapters when the GitHub App env is set, otherwise
 * console comments and "CI not green" (bounties go on_hold → maintainer decides).
 * `bounties` defaults to in-memory; app.ts passes a DrizzleBountyRepo when DATABASE_URL is set.
 */
export function defaultPrDeps(
  bus: EventBus,
  env: GithubAppEnv = process.env,
  bounties: BountyRepo = new InMemoryBountyRepo(),
): PrDeps {
  if (!env.GITHUB_APP_ID || !env.GITHUB_PRIVATE_KEY || !env.GITHUB_WEBHOOK_SECRET) {
    return { bounties, bus, notifier: new ConsoleNotifier(), ci: new FixedCiReader(false) };
  }
  const gh = createGithubApp(readGithubAppConfig(env));
  const clientFor: ClientFor = async (id) =>
    (await gh.getInstallationOctokit(id)) as unknown as RequestClient;
  return { bounties, bus, notifier: new OctokitNotifier(clientFor), ci: new OctokitCiReader(clientFor) };
}
