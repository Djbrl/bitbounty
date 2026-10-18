import { describe, expect, it } from "vitest";
import { parseAmount } from "./amount.js";
import { canRun, COMMAND_NAMES, resolveRole } from "./permissions.js";
import { parseCommand, type CommandContext, type ParseResult } from "./parse.js";

const maintainer: CommandContext = { login: "maintainer-demo", type: "User", permission: "write" };
const contributor: CommandContext = { login: "awa", type: "User", permission: "read" };
const bot: CommandContext = { login: "bitbounty[bot]", type: "Bot", botLogin: "bitbounty[bot]" };

function cmd(result: ParseResult) {
  if (result.type !== "command") throw new Error(`expected a command, got ${JSON.stringify(result)}`);
  return result.command;
}
function err(result: ParseResult) {
  if (result.type !== "error") throw new Error(`expected an error, got ${JSON.stringify(result)}`);
  return result;
}

describe("parseAmount", () => {
  it.each([
    ["10000", 10000],
    ["10 000", 10000],
    ["10 000", 10000],
    ["10 000", 10000],
    ["10,000", 10000],
    ["1 000 000", 1_000_000],
    ["10k", 10000],
    ["10K", 10000],
    ["1.5k", 1500],
    ["1,5k", 1500],
    ["1.1k", 1100],
    ["2m", 2_000_000],
    ["10000 FCFA", 10000],
    ["10000FCFA", 10000],
    ["10 000 fcfa", 10000],
    ["10000 CFA", 10000],
    ["10000 F", 10000],
    ["10000 XOF", 10000],
    ["10k FCFA", 10000],
    ["  10000  ", 10000],
  ])("accepts %j as %d", (raw, expected) => {
    expect(parseAmount(raw)).toEqual({ ok: true, amountXof: expected, topUp: false });
  });

  it("marks +5000 as a top-up", () => {
    expect(parseAmount("+5000")).toEqual({ ok: true, amountXof: 5000, topUp: true });
  });

  it.each([
    ["", "missing"],
    ["abc", "invalid"],
    ["-5", "negative"],
    ["-5000", "negative"],
    ["−5000", "negative"],
    ["0", "zero"],
    ["0k", "zero"],
    ["000", "zero"],
    ["10000.5", "decimal"],
    ["10,5", "decimal"],
    ["1.2345k", "decimal"],
    ["10.000", "ambiguous"],
    ["1e5", "invalid"],
    ["10,00", "decimal"],
    ["1,0000", "decimal"],
    ["10 00", "invalid"],
    ["10000 20000", "invalid"],
    ["$10", "currency"],
    ["10 USD", "currency"],
    ["10 EUR", "currency"],
    ["5000 sats", "currency"],
    ["50", "too_small"],
    ["10000001", "too_large"],
    ["999999999999999999999", "too_large"],
    ["Infinity", "invalid"],
    ["NaN", "invalid"],
    ["0x10", "invalid"],
  ])("rejects %j (%s)", (raw, error) => {
    const r = parseAmount(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(error);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("honours custom limits", () => {
    expect(parseAmount("50", { min: 1 })).toMatchObject({ ok: true, amountXof: 50 });
    expect(parseAmount("20000", { max: 15000 })).toMatchObject({ ok: false, error: "too_large" });
  });
});

describe("resolveRole", () => {
  it("detects bots by type, [bot] suffix and our own login", () => {
    expect(resolveRole({ login: "x", type: "Bot" })).toBe("bot");
    expect(resolveRole({ login: "dependabot[bot]", type: "User" })).toBe("bot");
    expect(resolveRole({ login: "BitBounty-App", botLogin: "bitbounty-app", permission: "admin" })).toBe("bot");
  });

  it.each(["admin", "maintain", "write", "WRITE"])("permission %s is maintainer", (permission) => {
    expect(resolveRole({ login: "m", permission })).toBe("maintainer");
  });

  it.each(["triage", "read", "none"])("permission %s is contributor", (permission) => {
    expect(resolveRole({ login: "c", permission })).toBe("contributor");
  });

  it("permission wins over author_association", () => {
    expect(resolveRole({ login: "c", authorAssociation: "OWNER", permission: "read" })).toBe("contributor");
    expect(resolveRole({ login: "m", authorAssociation: "NONE", permission: "write" })).toBe("maintainer");
  });

  it("falls back to author_association: only OWNER is trusted", () => {
    expect(resolveRole({ login: "m", authorAssociation: "OWNER" })).toBe("maintainer");
    for (const a of ["MEMBER", "COLLABORATOR", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE"]) {
      expect(resolveRole({ login: "c", authorAssociation: a })).toBe("contributor");
    }
    expect(resolveRole({ login: "c" })).toBe("contributor");
  });

  it("permission table", () => {
    for (const name of COMMAND_NAMES) {
      expect(canRun("maintainer", name)).toBe(true);
      expect(canRun("bot", name)).toBe(false);
    }
    expect(COMMAND_NAMES.filter((n) => canRun("contributor", n))).toEqual(["claim", "unclaim", "extend"]);
  });
});

describe("parseCommand: every command", () => {
  it("/bounty <amount>", () => {
    expect(cmd(parseCommand("/bounty 10000", maintainer))).toEqual({ name: "bounty", amountXof: 10000, topUp: false });
    expect(cmd(parseCommand("/bounty 10 000 FCFA", maintainer))).toMatchObject({ amountXof: 10000 });
    expect(cmd(parseCommand("/bounty 10k", maintainer))).toMatchObject({ amountXof: 10000 });
    expect(cmd(parseCommand("/bounty +5000", maintainer))).toEqual({ name: "bounty", amountXof: 5000, topUp: true });
  });

  it("/bounty errors carry a reply", () => {
    expect(err(parseCommand("/bounty", maintainer))).toMatchObject({ code: "missing_argument", command: "bounty" });
    for (const bad of ["-5", "abc", "0", "10.5", "99999999999", "10 USD"]) {
      const e = err(parseCommand(`/bounty ${bad}`, maintainer));
      expect(e.code).toBe("invalid_amount");
      expect(e.message).toMatch(/\w/);
    }
  });

  it("/criteria ok", () => {
    expect(cmd(parseCommand("/criteria ok", maintainer))).toEqual({ name: "criteria", action: "approve" });
    expect(cmd(parseCommand("/criteria OK", maintainer))).toEqual({ name: "criteria", action: "approve" });
    expect(cmd(parseCommand("/criteria ok!", maintainer))).toEqual({ name: "criteria", action: "approve" });
    expect(err(parseCommand("/criteria", maintainer)).code).toBe("missing_argument");
    expect(err(parseCommand("/criteria maybe", maintainer)).code).toBe("invalid_argument");
  });

  it("/claim /unclaim /extend, with or without a note", () => {
    expect(cmd(parseCommand("/claim", contributor))).toEqual({ name: "claim", note: null });
    expect(cmd(parseCommand("/claim I'll do it tonight", contributor))).toEqual({
      name: "claim",
      note: "I'll do it tonight",
    });
    expect(cmd(parseCommand("/unclaim", contributor))).toEqual({ name: "unclaim", note: null });
    expect(cmd(parseCommand("/extend", contributor))).toEqual({ name: "extend", note: null });
  });

  it("maintainers can also claim", () => {
    expect(cmd(parseCommand("/claim", maintainer))).toEqual({ name: "claim", note: null });
  });

  it("/pay [@user] [now]", () => {
    expect(cmd(parseCommand("/pay", maintainer))).toEqual({ name: "pay", user: null, now: false });
    expect(cmd(parseCommand("/pay now", maintainer))).toEqual({ name: "pay", user: null, now: true });
    expect(cmd(parseCommand("/pay @awa", maintainer))).toEqual({ name: "pay", user: "awa", now: false });
    expect(cmd(parseCommand("/pay @awa-dev now", maintainer))).toEqual({ name: "pay", user: "awa-dev", now: true });
    expect(cmd(parseCommand("/pay NOW @awa", maintainer))).toEqual({ name: "pay", user: "awa", now: true });
    expect(err(parseCommand("/pay awa", maintainer)).code).toBe("invalid_argument");
    expect(err(parseCommand("/pay @awa @moussa", maintainer)).code).toBe("invalid_argument");
    expect(err(parseCommand("/pay @-bad", maintainer)).code).toBe("invalid_argument");
    expect(err(parseCommand("/pay now now", maintainer)).code).toBe("invalid_argument");
    expect(err(parseCommand("/pay 10000", maintainer)).code).toBe("invalid_argument");
  });

  it("/hold, /cancel", () => {
    expect(cmd(parseCommand("/hold", maintainer))).toEqual({ name: "hold", note: null });
    expect(cmd(parseCommand("/hold PR was reverted", maintainer))).toEqual({ name: "hold", note: "PR was reverted" });
    expect(cmd(parseCommand("/cancel", maintainer))).toEqual({ name: "cancel", note: null });
  });

  it("/funded (sandbox demo), case-insensitive, extra words ignored", () => {
    expect(cmd(parseCommand("/funded", maintainer))).toEqual({ name: "funded" });
    expect(cmd(parseCommand("/FUNDED please", maintainer))).toEqual({ name: "funded" });
    expect(parseCommand("`/funded`", maintainer)).toEqual({ type: "ignore", reason: "no_command" });
    expect(parseCommand("> /funded", maintainer)).toEqual({ type: "ignore", reason: "no_command" });
    expect(parseCommand("/fundedx", maintainer)).toEqual({ type: "ignore", reason: "no_command" });
  });

  it("/reject <reason>", () => {
    expect(cmd(parseCommand("/reject tests don't cover the edge case", maintainer))).toEqual({
      name: "reject",
      reason: "tests don't cover the edge case",
    });
    expect(err(parseCommand("/reject", maintainer)).code).toBe("missing_argument");
    expect(err(parseCommand("/reject    ", maintainer)).code).toBe("missing_argument");
  });
});

describe("parseCommand: permissions", () => {
  it.each(["/bounty 10000", "/criteria ok", "/pay", "/pay @awa now", "/hold", "/reject nope", "/cancel", "/funded"])(
    "a contributor can't run %s",
    (body) => {
      const e = err(parseCommand(body, contributor));
      expect(e.code).toBe("forbidden");
      expect(e.role).toBe("contributor");
      expect(e.message).toMatch(/maintainers/i);
    },
  );

  it("forbidden is reported before argument errors", () => {
    expect(err(parseCommand("/bounty abc", contributor)).code).toBe("forbidden");
  });

  it("uses the product copy for an unauthorised /bounty", () => {
    expect(err(parseCommand("/bounty 10000", contributor)).message).toBe(
      "Only maintainers (write access on this repo) can fund here.",
    );
  });

  it("an org member without a permission lookup can't pay", () => {
    expect(err(parseCommand("/pay", { login: "x", authorAssociation: "MEMBER" })).code).toBe("forbidden");
  });

  it("the repo owner can pay from author_association alone", () => {
    expect(cmd(parseCommand("/pay", { login: "x", authorAssociation: "OWNER" }))).toMatchObject({ name: "pay" });
  });

  it("ignores every comment from a bot, ours included", () => {
    for (const body of ["/bounty 10000", "/pay now", "/claim", "💰 **Bounty: 10,000 FCFA**\n/claim"]) {
      expect(parseCommand(body, bot)).toEqual({ type: "ignore", reason: "bot_author" });
    }
    expect(parseCommand("/claim", { login: "renovate[bot]", type: "Bot" })).toEqual({
      type: "ignore",
      reason: "bot_author",
    });
  });
});

describe("parseCommand: try to break it", () => {
  it("is case-insensitive", () => {
    expect(cmd(parseCommand("/BOUNTY 5000", maintainer))).toMatchObject({ name: "bounty", amountXof: 5000 });
    expect(cmd(parseCommand("/Claim", contributor))).toMatchObject({ name: "claim" });
  });

  it("tolerates extra whitespace", () => {
    expect(cmd(parseCommand("   /bounty     10000   ", maintainer))).toMatchObject({ amountXof: 10000 });
    expect(cmd(parseCommand("/bounty\t10000", maintainer))).toMatchObject({ amountXof: 10000 });
    expect(cmd(parseCommand("\n\n  /claim  \n\n", contributor))).toMatchObject({ name: "claim" });
    expect(cmd(parseCommand("/bounty 10000\r\n", maintainer))).toMatchObject({ amountXof: 10000 });
  });

  it("ignores a command mid-sentence", () => {
    expect(parseCommand("Can I /claim this?", contributor)).toEqual({ type: "ignore", reason: "no_command" });
    expect(parseCommand("Maintainers write /bounty 10000 to fund", maintainer)).toMatchObject({ type: "ignore" });
  });

  it("finds a command on a later line", () => {
    const r = parseCommand("Hi! I fixed this before.\n/claim\nThanks", contributor);
    expect(r).toMatchObject({ type: "command", line: 2, command: { name: "claim" } });
  });

  it("ignores commands in fenced code blocks", () => {
    const body = "Here is how:\n```\n/bounty 10000\n```\n";
    expect(parseCommand(body, maintainer)).toEqual({ type: "ignore", reason: "no_command" });
    expect(parseCommand("~~~md\n/pay now\n~~~", maintainer)).toMatchObject({ type: "ignore" });
    expect(parseCommand("````\n```\n/pay\n```\n````", maintainer)).toMatchObject({ type: "ignore" });
    expect(parseCommand("```\n/pay now", maintainer)).toMatchObject({ type: "ignore" }); // unclosed
  });

  it("runs a command after a closed code block", () => {
    expect(cmd(parseCommand("```\n/pay now\n```\n/hold", maintainer))).toMatchObject({ name: "hold" });
  });

  it("ignores inline code and indented code", () => {
    expect(parseCommand("`/bounty 10000`", maintainer)).toMatchObject({ type: "ignore" });
    expect(parseCommand("Example:\n\n    /pay now", maintainer)).toMatchObject({ type: "ignore" });
    expect(parseCommand("\t/pay now", maintainer)).toMatchObject({ type: "ignore" });
  });

  it("ignores quoted commands (replying to someone)", () => {
    expect(parseCommand("> /pay now\n\nI disagree", maintainer)).toEqual({ type: "ignore", reason: "no_command" });
    expect(parseCommand(">/claim", contributor)).toMatchObject({ type: "ignore" });
    expect(parseCommand("> > /bounty 10000", maintainer)).toMatchObject({ type: "ignore" });
    expect(cmd(parseCommand("> /pay now\n/hold", maintainer))).toMatchObject({ name: "hold" });
  });

  it("ignores commands in HTML comments", () => {
    expect(parseCommand("<!-- /pay now -->", maintainer)).toMatchObject({ type: "ignore" });
    expect(parseCommand("<!--\n/pay now\n-->", maintainer)).toMatchObject({ type: "ignore" });
    expect(cmd(parseCommand("<!-- note -->\n/hold", maintainer))).toMatchObject({ name: "hold" });
  });

  it("ignores unknown slash words and glued names", () => {
    expect(parseCommand("/assign @awa", maintainer)).toMatchObject({ type: "ignore", reason: "no_command" });
    expect(parseCommand("/usr/bin/env node", maintainer)).toMatchObject({ type: "ignore" });
    expect(parseCommand("/bounty10000", maintainer)).toMatchObject({ type: "ignore" });
    expect(parseCommand("/claimed it", contributor)).toMatchObject({ type: "ignore" });
    expect(parseCommand("//claim", contributor)).toMatchObject({ type: "ignore" });
  });

  it("first command wins, the rest are reported", () => {
    const r = parseCommand("/bounty 10000\n/criteria ok\n/pay now", maintainer);
    expect(r).toMatchObject({ type: "command", command: { name: "bounty" }, extraCommands: ["criteria", "pay"] });
  });

  it("empty and whitespace-only bodies", () => {
    expect(parseCommand("", contributor)).toEqual({ type: "ignore", reason: "empty" });
    expect(parseCommand("  \n\t ", contributor)).toEqual({ type: "ignore", reason: "empty" });
  });

  it("the issue's break-it list", () => {
    expect(cmd(parseCommand("/bounty 10,000", maintainer))).toMatchObject({ amountXof: 10000 });
    expect(cmd(parseCommand("/bounty 10 000", maintainer))).toMatchObject({ amountXof: 10000 });
    expect(err(parseCommand("/bounty -5", maintainer)).code).toBe("invalid_amount");
    expect(err(parseCommand("/bounty abc", maintainer)).code).toBe("invalid_amount");
    expect(cmd(parseCommand("/BOUNTY 5000", maintainer))).toMatchObject({ amountXof: 5000 });
    expect(parseCommand("I think /bounty 5000 is fair", maintainer)).toMatchObject({ type: "ignore" });
    expect(err(parseCommand("/pay", contributor)).code).toBe("forbidden");
  });

  it("works on the real webhook fixture", async () => {
    const { default: payload } = await import("../__fixtures__/issue_comment.created.json", { with: { type: "json" } });
    const c = payload.comment;
    const r = parseCommand(c.body, {
      login: c.user.login,
      type: c.user.type,
      authorAssociation: c.author_association,
    });
    expect(r).toMatchObject({ type: "command", command: { name: "bounty", amountXof: 10000 }, role: "maintainer" });
  });
});
