/**
 * Who is allowed to run which command (docs/plan.md, "GitHub commands"):
 * - `/bounty /criteria /pay /hold /reject /cancel` need write access on the repo (maintainer).
 * - `/claim /unclaim /extend` are open to any human. Whether they have a linked payout
 *   account is checked by the caller (G3), not here: the parser has no database.
 * - Bots (including BitBounty itself) never run commands.
 */

export type Role = "maintainer" | "contributor" | "bot";

/** GitHub's `comment.author_association`. */
export type AuthorAssociation =
  | "OWNER"
  | "MEMBER"
  | "COLLABORATOR"
  | "CONTRIBUTOR"
  | "FIRST_TIME_CONTRIBUTOR"
  | "FIRST_TIMER"
  | "MANNEQUIN"
  | "NONE";

/** `GET /repos/{owner}/{repo}/collaborators/{username}/permission` → `.permission` (or `.role_name`). */
export type RepoPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none";

export interface AuthorInfo {
  /** `comment.user.login`. */
  login: string;
  /** `comment.user.type`: "User", "Bot" or "Organization". */
  type?: string;
  /** `comment.author_association`. Used only when `permission` is not given. */
  authorAssociation?: AuthorAssociation | string;
  /**
   * The author's real permission on the repo, looked up through the API. Authoritative: when set,
   * it wins over `authorAssociation`. G3 should pass it, because the association alone can't tell
   * a read-only collaborator or org member from one with write access.
   */
  permission?: RepoPermission | string;
  /** Our own app's login, e.g. "bitbounty[bot]". */
  botLogin?: string;
}

const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

export function resolveRole(author: AuthorInfo): Role {
  const login = author.login.toLowerCase();
  if (
    author.type === "Bot" ||
    login.endsWith("[bot]") ||
    (author.botLogin !== undefined && login === author.botLogin.toLowerCase())
  ) {
    return "bot";
  }
  if (author.permission !== undefined) {
    return WRITE_PERMISSIONS.has(author.permission.toLowerCase()) ? "maintainer" : "contributor";
  }
  // Without a permission lookup, only the repo owner is certain to have write access.
  // MEMBER and COLLABORATOR can be read-only, so they fall back to contributor (fail safe for money).
  return author.authorAssociation === "OWNER" ? "maintainer" : "contributor";
}

export const MAINTAINER_COMMANDS = ["bounty", "criteria", "pay", "hold", "reject", "cancel"] as const;
export const CONTRIBUTOR_COMMANDS = ["claim", "unclaim", "extend"] as const;
export const COMMAND_NAMES = [...MAINTAINER_COMMANDS, ...CONTRIBUTOR_COMMANDS] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export function isCommandName(name: string): name is CommandName {
  return (COMMAND_NAMES as readonly string[]).includes(name);
}

export function canRun(role: Role, command: CommandName): boolean {
  if (role === "bot") return false;
  if (role === "maintainer") return true;
  return (CONTRIBUTOR_COMMANDS as readonly string[]).includes(command);
}
