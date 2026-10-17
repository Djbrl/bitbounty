import type { GithubDispatcher } from "../dispatcher.js";
import { handleIssueComment, type WiringDeps } from "./handle-comment.js";

export { handleIssueComment, type CommentOutcome, type WiringDeps } from "./handle-comment.js";
export { syncIssue, type SyncOptions } from "./sync.js";
export {
  FakeGithubWriter,
  installationWriterFactory,
  octokitWriter,
  type GithubWriter,
  type GithubWriterFactory,
  type IssueComment,
  type RequestClient,
} from "./writer.js";

/** G3: plugs the comment commands into the webhook dispatcher. */
export function registerCommentWiring(dispatcher: GithubDispatcher, deps: WiringDeps): GithubDispatcher {
  const log = deps.log ?? console;
  return dispatcher.on("issue_comment.created", async (event) => {
    const outcome = await handleIssueComment(event, deps);
    if (outcome.kind !== "ignored") {
      log.info(`[github] ${event.repo}#${(event.payload as any)?.issue?.number} ${outcome.kind}`);
    }
  });
}
