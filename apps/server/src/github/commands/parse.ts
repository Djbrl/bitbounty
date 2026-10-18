import { parseAmount } from "./amount.js";
import { canRun, isCommandName, resolveRole, type AuthorInfo, type CommandName, type Role } from "./permissions.js";

/**
 * `parseCommand(body, context)`: pure. Turns a GitHub comment into one BitBounty command,
 * an error the bot can reply with, or "ignore" (stay silent).
 *
 * Rules:
 * - A command must start a line (leading whitespace allowed): `please /claim` mid-sentence is ignored.
 * - Lines inside fenced code blocks (``` / ~~~), indented code (4+ spaces or a tab), quotes (`>`)
 *   and HTML comments are ignored, so quoting or documenting a command never runs it.
 * - Command names are case-insensitive (`/BOUNTY 5000` works). Unknown `/words` are ignored
 *   (other bots and file paths use slashes too).
 * - The first BitBounty command line wins. Later ones are reported in `extraCommands` so the bot
 *   can say "one command per comment".
 * - Comments from bots (including our own) are always ignored, so the bot can't loop on itself.
 */

export type Command =
  | { name: "bounty"; amountXof: number; topUp: boolean }
  | { name: "criteria"; action: "approve" }
  | { name: "claim"; note: string | null }
  | { name: "unclaim"; note: string | null }
  | { name: "extend"; note: string | null }
  | { name: "pay"; user: string | null; now: boolean }
  | { name: "hold"; note: string | null }
  | { name: "reject"; reason: string }
  | { name: "cancel"; note: string | null }
  /** Sandbox demo: simulates the funding payment (Bitnob simulate-payment). Maintainers only. */
  | { name: "funded" };

export type CommandErrorCode =
  | "forbidden"
  | "invalid_amount"
  | "missing_argument"
  | "invalid_argument";

export type ParseResult =
  | {
      type: "command";
      command: Command;
      role: Role;
      /** 1-based line of the command in the comment. */
      line: number;
      /** Other command names found after the first one (not run). */
      extraCommands: CommandName[];
    }
  | {
      type: "error";
      code: CommandErrorCode;
      command: CommandName;
      role: Role;
      /** Markdown, ready for the bot's reply. */
      message: string;
    }
  | { type: "ignore"; reason: "bot_author" | "no_command" | "empty" };

export interface CommandContext extends AuthorInfo {
  minAmountXof?: number;
  maxAmountXof?: number;
}

const GITHUB_LOGIN = /^@?([a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})$/i;

interface CommandLine {
  name: CommandName;
  args: string;
  line: number;
}

/** Every line that looks like a BitBounty command, outside code, quotes and HTML comments. */
export function findCommandLines(body: string): CommandLine[] {
  const out: CommandLine[] = [];
  const lines = body.split(/\r\n|\r|\n/);
  let fence: { char: string; len: number } | null = null;
  let inHtmlComment = false;

  lines.forEach((rawLine, i) => {
    let text = rawLine;

    if (inHtmlComment) {
      const end = text.indexOf("-->");
      if (end === -1) return;
      inHtmlComment = false;
      text = text.slice(end + 3);
    }

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fence) {
      if (fenceMatch && fenceMatch[1]![0] === fence.char && fenceMatch[1]!.length >= fence.len) {
        if (text.trim() === fenceMatch[1]) fence = null;
      }
      return;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1]![0]!, len: fenceMatch[1]!.length };
      return;
    }

    // Strip HTML comments that open on this line.
    text = text.replace(/<!--[\s\S]*?-->/g, "");
    const open = text.indexOf("<!--");
    if (open !== -1) {
      inHtmlComment = true;
      text = text.slice(0, open);
    }

    if (/^( {4,}|\t)/.test(text)) return; // indented code block
    if (/^ {0,3}>/.test(text)) return; // quote

    const m = /^\s*\/([a-z]+)(?=$|\s)(.*)$/i.exec(text);
    if (!m) return;
    const name = m[1]!.toLowerCase();
    if (!isCommandName(name)) return;
    out.push({ name, args: m[2]!.trim(), line: i + 1 });
  });

  return out;
}

const USAGE: Record<CommandName, string> = {
  bounty: "`/bounty <amount in FCFA>`, e.g. `/bounty 10000`",
  criteria: "`/criteria ok`",
  claim: "`/claim`",
  unclaim: "`/unclaim`",
  extend: "`/extend`",
  pay: "`/pay [@user] [now]`",
  hold: "`/hold`",
  reject: "`/reject <reason>`",
  cancel: "`/cancel`",
  funded: "`/funded` (sandbox only: simulates the funding payment)",
};

function forbiddenMessage(name: CommandName): string {
  if (name === "bounty") return "Only maintainers (write access on this repo) can fund here.";
  return `Only maintainers (write access on this repo) can use \`/${name}\`.`;
}

export function parseCommand(body: string, context: CommandContext): ParseResult {
  const role = resolveRole(context);
  if (role === "bot") return { type: "ignore", reason: "bot_author" };
  if (body.trim() === "") return { type: "ignore", reason: "empty" };

  const found = findCommandLines(body);
  const first = found[0];
  if (!first) return { type: "ignore", reason: "no_command" };
  const { name, args, line } = first;

  const error = (code: CommandErrorCode, message: string): ParseResult => ({
    type: "error",
    code,
    command: name,
    role,
    message,
  });

  // Permission first: a contributor trying `/pay` learns they can't, not how to format it.
  if (!canRun(role, name)) return error("forbidden", forbiddenMessage(name));

  const note = args === "" ? null : args;
  let command: Command;
  switch (name) {
    case "bounty": {
      const amount = parseAmount(args, { min: context.minAmountXof, max: context.maxAmountXof });
      if (!amount.ok) {
        return error(amount.error === "missing" ? "missing_argument" : "invalid_amount", amount.message);
      }
      command = { name, amountXof: amount.amountXof, topUp: amount.topUp };
      break;
    }
    case "criteria": {
      if (args.toLowerCase().replace(/[.!]+$/, "") !== "ok") {
        return error(
          args === "" ? "missing_argument" : "invalid_argument",
          `To approve the proposed criteria, write ${USAGE.criteria}. To change them, edit the issue description.`,
        );
      }
      command = { name, action: "approve" };
      break;
    }
    case "pay": {
      let user: string | null = null;
      let now = false;
      for (const token of args.split(/\s+/).filter(Boolean)) {
        if (token.toLowerCase() === "now") {
          if (now) return error("invalid_argument", `\`now\` is given twice. Usage: ${USAGE.pay}.`);
          now = true;
          continue;
        }
        const login = token.startsWith("@") ? GITHUB_LOGIN.exec(token) : null;
        if (!login) {
          return error("invalid_argument", `I don't understand \`${token}\`. Usage: ${USAGE.pay}.`);
        }
        if (user) return error("invalid_argument", `Only one person can be paid per bounty. Usage: ${USAGE.pay}.`);
        user = login[1]!;
      }
      command = { name, user, now };
      break;
    }
    case "reject": {
      if (args === "") {
        return error("missing_argument", `Please give a reason so the contributor knows what to fix: ${USAGE.reject}.`);
      }
      command = { name, reason: args };
      break;
    }
    case "claim":
    case "unclaim":
    case "extend":
    case "hold":
    case "cancel":
      command = { name, note };
      break;
    case "funded":
      command = { name };
      break;
  }

  return {
    type: "command",
    command,
    role,
    line,
    extraCommands: found.slice(1).map((c) => c.name),
  };
}
