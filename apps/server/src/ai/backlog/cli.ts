// pnpm --filter @bitbounty/server backlog <owner/name> [--max 60]
// Prints the "Price my backlog" suggestions for a public repo (or private with BACKLOG_GITHUB_TOKEN).
import { GithubIssuesError } from "./github-issues.js";
import { priceRepoBacklog } from "./suggest.js";

const usage = "usage: pnpm --filter @bitbounty/server backlog <owner/name> [--max 60]";
const args = process.argv.slice(2);
let repo: string | undefined;
let maxIssues: number | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max") {
    maxIssues = Number(args[++i]);
    if (!Number.isInteger(maxIssues) || maxIssues < 1) {
      console.error(`--max needs a positive whole number\n${usage}`);
      process.exit(1);
    }
  } else if (!repo) repo = args[i];
}
if (!repo) {
  console.error(usage);
  process.exit(1);
}

const started = Date.now();
try {
  const result = await priceRepoBacklog(repo, {
    maxIssues,
    github: { token: process.env.BACKLOG_GITHUB_TOKEN?.trim() || undefined },
  });
  console.log(JSON.stringify(result, null, 2));
  console.error(
    `\n${result.suggestions.length} suggestions from ${result.issuesConsidered}/${result.issuesRead} issues` +
      ` in ${((Date.now() - started) / 1000).toFixed(1)} s (${result.model})`,
  );
} catch (err) {
  console.error(err instanceof GithubIssuesError ? `error: ${err.message}` : err);
  process.exitCode = 1;
}
