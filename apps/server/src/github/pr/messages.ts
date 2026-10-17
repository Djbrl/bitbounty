/** Bot comment texts. Pure, so tests can assert on them. */

export function notClaimantMessage(issue: number, claimant: string, author: string): string {
  return [
    `Thanks for the PR, @${author}! Issue #${issue} has a BitBounty bounty claimed by @${claimant}, so this PR isn't linked to it.`,
    `If the maintainer wants to pay you instead, they can reply \`/pay @${author}\` on #${issue}.`,
  ].join("\n");
}

export function unclaimedMessage(issue: number, author: string): string {
  return [
    `Thanks for the PR, @${author}! Issue #${issue} has a BitBounty bounty nobody has claimed yet.`,
    `Comment \`/claim\` on #${issue}, then push again (or edit this PR) to link it.`,
  ].join("\n");
}

/** Merge that BitBounty couldn't tie to the bounty: the maintainer decides. */
export function missingLinkMessage(
  issue: number,
  pr: number,
  author: string,
  claimant: string | null,
): string {
  const payee = claimant ?? author;
  const lines = [
    `PR #${pr} by @${author} was merged, but it isn't linked to the bounty on #${issue}` +
      (claimant && claimant.toLowerCase() !== author.toLowerCase()
        ? ` (claimed by @${claimant}).`
        : " (no \"Fixes #" + issue + "\" from the claimant)."),
    `Is PR #${pr} the fix for #${issue}? Reply \`/pay @${payee}\` to release the bounty` +
      (payee.toLowerCase() !== author.toLowerCase() ? ` (or \`/pay @${author}\`)` : "") +
      ", or ignore this if it isn't.",
  ];
  return lines.join("\n");
}
