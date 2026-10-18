/**
 * B6 live proof on Bitnob PRODUCTION: one tiny real Lightning payout, by a human.
 *
 *   pnpm --filter @bitbounty/server live-pay -- --sats 100                  # dry run (default): nothing is sent
 *   pnpm --filter @bitbounty/server live-pay -- --xof 50                    # FCFA → sats at Bitnob's rate (needs creds)
 *   pnpm --filter @bitbounty/server live-pay -- --sats 100 --pay            # pays ONE invoice after you type 100
 *   options: --env-file <path> (default: repo-root .env.prod)  --max-sats <n> (hard cap, default 1000)
 *
 * Env file: BITNOB_PROD_CLIENT_ID, BITNOB_PROD_CLIENT_SECRET, LIVE_TEST_LIGHTNING_ADDRESS
 * (optional BITNOB_PROD_PAYOUT_CUSTOMER_ID). Secrets are never printed.
 *
 * Dry run: resolve the Lightning Address with B6's LNURL resolver (network `bitcoin`), request the
 * real invoice for the exact amount (requesting an invoice costs nothing), decode it with B6's
 * BOLT11 decoder and check amount, network, expiry and description hash; with creds, `whoami`.
 * `--pay`: same checks, refuses unless `whoami` says production, asks you to type the exact sats,
 * then pays through B6's own `PayoutService` (same code path as a bounty payout: one
 * `POST /api/lightning/pay`, reference `pay-live-test-<timestamp>-1`, never re-sent unless no
 * status read finds it, never a second attempt) and polls the status.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { BitnobClient, BitnobError } from "@bitbounty/bitnob";
import { maskLightningAddress, parseLightningAddress } from "@bitbounty/core";
import { BitnobRates } from "../src/funding/index.js";
import {
  decodeBolt11,
  HttpLnurlResolver,
  InMemoryPayoutStore,
  LnurlError,
  PayoutService,
  payoutSats,
  type LightningRails,
  type LnurlResolver,
  type ResolvedInvoice,
} from "../src/payouts/index.js";

export const DEFAULT_ADDRESS = "bitbounty@blink.sv";
export const DEFAULT_MAX_SATS = 1000;
/** Refuse an invoice with less than this left (the human needs time to confirm). */
const MIN_EXPIRY_S = 120;

export interface LivePayArgs {
  envFile: string;
  xof?: number;
  sats?: number;
  maxSats: number;
  pay: boolean;
}

/** The Bitnob calls this script makes. `BitnobClient` satisfies it. */
export type LiveBitnob = Pick<BitnobClient, "whoami" | "getExchangeRate" | "getTradingPrice"> & LightningRails;

export interface LivePayDeps {
  /** Contents of the env file (already parsed). */
  env: Record<string, string | undefined>;
  /** Builds a production client from the creds; called only when both are present. */
  bitnob: (clientId: string, clientSecret: string) => LiveBitnob;
  fetch?: typeof fetch;
  prompt: (question: string) => Promise<string>;
  out: (line: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** How long `--pay` polls for the outcome. Default 3 min. */
  pollForMs?: number;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[], defaultEnvFile: string): LivePayArgs {
  const out: LivePayArgs = { envFile: defaultEnvFile, maxSats: DEFAULT_MAX_SATS, pay: false };
  const num = (flag: string, v: string | undefined) => {
    if (!v || !/^\d+$/.test(v) || Number(v) < 1) throw new UsageError(`${flag} needs a positive whole number`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i]!.split("=", 2) as [string, string | undefined];
    const value = () => inline ?? argv[++i];
    if (flag === "--") continue;
    else if (flag === "--pay") out.pay = true;
    else if (flag === "--env-file") out.envFile = value() ?? "";
    else if (flag === "--xof") out.xof = num("--xof", value());
    else if (flag === "--sats") out.sats = num("--sats", value());
    else if (flag === "--max-sats") out.maxSats = num("--max-sats", value());
    else throw new UsageError(`unknown option ${flag}`);
  }
  if ((out.xof === undefined) === (out.sats === undefined)) throw new UsageError("give exactly one of --xof <FCFA> or --sats <n>");
  if (!out.envFile) throw new UsageError("--env-file needs a path");
  return out;
}

/** Reads a dotenv file; a missing file is an error (say which one). */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) throw new UsageError(`env file not found: ${path} (pass --env-file <path>)`);
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
}

const group = (n: number | bigint) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * Dry run, or the real thing with `--pay`. Returns the process exit code:
 * 0 ok, 1 payment failed / unknown, 2 refused by a check, 3 aborted at the confirmation prompt.
 */
export async function runLivePay(args: LivePayArgs, deps: LivePayDeps): Promise<number> {
  const out = deps.out;
  const now = deps.now ?? (() => new Date());
  const refuse = (why: string) => {
    out(`REFUSED: ${why}`);
    return 2;
  };

  // ---- inputs ----
  const configured = deps.env.LIVE_TEST_LIGHTNING_ADDRESS?.trim();
  if (args.pay && !configured) return refuse("--pay needs LIVE_TEST_LIGHTNING_ADDRESS in the env file (no default destination for real money)");
  const address = configured || DEFAULT_ADDRESS;
  if (!parseLightningAddress(address)) return refuse(`LIVE_TEST_LIGHTNING_ADDRESS is not a Lightning Address (${maskLightningAddress(address)})`);
  if (args.sats !== undefined && args.sats > args.maxSats) {
    return refuse(`${group(args.sats)} sats is above the hard cap --max-sats ${group(args.maxSats)}`);
  }

  // ---- Bitnob: whoami (never prints the creds) ----
  const id = deps.env.BITNOB_PROD_CLIENT_ID?.trim();
  const secret = deps.env.BITNOB_PROD_CLIENT_SECRET?.trim();
  let client: LiveBitnob | null = null;
  let environment: string | null = null;
  if (id && secret) {
    client = deps.bitnob(id, secret);
    try {
      const who = await client.whoami();
      environment = String(who.environment ?? "unknown").toLowerCase();
      out(`whoami: environment=${environment} client_name=${JSON.stringify(who.client_name ?? "")}`);
    } catch (err) {
      if (err instanceof BitnobError && err.status === 401) {
        out(
          "whoami: 401 Unauthorized. Hint: the client ID and secret don't belong together (Bitnob: same client ID across " +
            "environments, only the secret changes; a secret issued for another company won't work with ours).",
        );
      } else {
        out(`whoami failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else {
    out("whoami: skipped (no BITNOB_PROD_CLIENT_ID / BITNOB_PROD_CLIENT_SECRET in the env file)");
  }
  if (args.pay && environment !== "production") {
    return refuse(`--pay needs whoami environment=production (got ${environment ?? "no answer"})`);
  }

  // ---- amount ----
  let sats: number;
  let xof: number | null = null;
  let xofPerBtc: number | null = null;
  if (args.sats !== undefined) {
    sats = args.sats;
  } else {
    if (!client) return refuse("--xof needs Bitnob creds for the rate; pass --sats <n> instead");
    try {
      const q = await payoutSats(new BitnobRates(client), args.xof!);
      sats = q.sats;
      xofPerBtc = q.xofPerBtc;
      xof = args.xof!;
    } catch (err) {
      return refuse(`rate unavailable (${err instanceof Error ? err.message : String(err)}); pass --sats <n> instead`);
    }
  }
  if (sats < 1) return refuse(`${xof} FCFA is less than 1 sat`);
  if (sats > args.maxSats) return refuse(`${group(sats)} sats is above the hard cap --max-sats ${group(args.maxSats)}`);

  // ---- LNURL-pay → invoice, checked by B6's resolver and again here ----
  const checked = await resolveAndCheck(address, sats, deps.fetch, now);
  if (typeof checked === "string") return refuse(checked);
  const { invoice, decoded, descriptionHash } = checked;
  const left = decoded.expiresAt - Math.floor(now().getTime() / 1000);
  const rows: [string, string][] = [
    ["Lightning Address", `${maskLightningAddress(address)}${configured ? "" : " (default)"}`],
    ["sats", group(sats)],
    ["FCFA", xof !== null ? `${group(xof)} (at ${group(Math.round(xofPerBtc!))} FCFA/BTC)` : "n/a (--sats, no rate)"],
    ["invoice amount", `${group(decoded.amountMsat!)} msat = ${group(decoded.amountMsat! / 1000n)} sats`],
    ["network", decoded.network],
    ["expiry", `${new Date(decoded.expiresAt * 1000).toISOString()} (in ${left} s)`],
    ["payment hash", decoded.paymentHash],
    ["description hash", descriptionHash],
    ["Bitnob environment", environment ?? "unknown (no whoami)"],
  ];
  const w = Math.max(...rows.map(([k]) => k.length));
  out("");
  for (const [k, v] of rows) out(`  ${k.padEnd(w)}  ${v}`);
  out("");

  if (!args.pay) {
    out("DRY RUN: nothing was sent to Bitnob. Add --pay to pay this amount for real.");
    return 0;
  }

  // ---- the real payment ----
  const answer = (await deps.prompt(`Type ${sats} to pay ${group(sats)} sats to ${maskLightningAddress(address)} on Bitnob PRODUCTION (anything else aborts): `)).trim();
  if (answer !== String(sats)) {
    out(`ABORTED: you typed ${JSON.stringify(answer)}, not ${sats}. Nothing was sent.`);
    return 3;
  }
  if (decoded.expiresAt - Math.floor(now().getTime() / 1000) < MIN_EXPIRY_S) {
    return refuse("the invoice is about to expire after the confirmation; run again");
  }
  return payOnce(client!, { address, sats, xof, xofPerBtc, invoice }, deps);
}

interface Checked {
  invoice: ResolvedInvoice;
  decoded: ReturnType<typeof decodeBolt11>;
  descriptionHash: string;
}

async function resolveAndCheck(address: string, sats: number, fetchFn: typeof fetch | undefined, now: () => Date): Promise<Checked | string> {
  const base = fetchFn ?? globalThis.fetch;
  let metadata: string | null = null;
  // Same fetch, but keep the LNURL metadata so the description hash can be shown as checked.
  const spy = (async (input: string | URL | Request, init?: RequestInit) => {
    const res = await base(input, init);
    if (String(input).includes("/.well-known/lnurlp/")) {
      try {
        const body = (await res.clone().json()) as { metadata?: unknown };
        if (typeof body.metadata === "string") metadata = body.metadata;
      } catch {
        // the resolver reports unreadable answers itself
      }
    }
    return res;
  }) as typeof fetch;
  const resolver: LnurlResolver = new HttpLnurlResolver({ network: "bitcoin", fetch: spy, now, minExpirySeconds: MIN_EXPIRY_S });
  let invoice: ResolvedInvoice;
  try {
    invoice = await resolver.invoiceFor(address, sats * 1000);
  } catch (err) {
    return err instanceof LnurlError ? `LNURL: ${err.message}` : `LNURL failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  // Belt and braces: decode again and re-check what we are about to pay.
  const decoded = decodeBolt11(invoice.bolt11);
  if (decoded.network !== "bitcoin") return `invoice is for ${decoded.network}, expected bitcoin (mainnet)`;
  if (decoded.amountMsat !== BigInt(sats) * 1000n) return `invoice is for ${decoded.amountMsat ?? "any amount"} msat, expected ${sats * 1000}`;
  if (decoded.paymentHash !== invoice.paymentHash) return "payment hash mismatch between resolver and decoder";
  const left = decoded.expiresAt - Math.floor(now().getTime() / 1000);
  if (left < MIN_EXPIRY_S) return `invoice expires in ${left} s (need ${MIN_EXPIRY_S} s)`;
  let descriptionHash = "none (invoice has a plain description)";
  if (decoded.descriptionHash) {
    if (metadata === null) return "invoice commits to a description hash but the LNURL metadata wasn't readable";
    const expected = createHash("sha256").update(metadata, "utf8").digest("hex");
    if (expected !== decoded.descriptionHash) return "description hash doesn't match the LNURL metadata";
    descriptionHash = `${decoded.descriptionHash} (= sha256(metadata) ✓)`;
  }
  return { invoice, decoded, descriptionHash };
}

/** Pays the checked invoice once through B6's PayoutService, then polls for the outcome. */
async function payOnce(
  client: LiveBitnob,
  p: { address: string; sats: number; xof: number | null; xofPerBtc: number | null; invoice: ResolvedInvoice },
  deps: LivePayDeps,
): Promise<number> {
  const out = deps.out;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const bountyId = `live-test-${now().getTime()}`;
  // The service recomputes sats from FCFA: freeze the rate we used (or, with --sats, a 1e8 FCFA/BTC
  // placeholder so that "FCFA" = sats), so it asks for exactly the amount the human confirmed.
  const frozen =
    p.xof !== null && p.xofPerBtc !== null
      ? { amountXof: p.xof, rates: { xofPerUsdt: async () => p.xofPerBtc!, usdtPerBtc: async () => 1 } }
      : { amountXof: p.sats, rates: { xofPerUsdt: async () => 100_000_000, usdtPerBtc: async () => 1 } };
  // Only the invoice the human just saw is payable.
  const pinned: LnurlResolver = {
    invoiceFor: async (address, msat) => {
      if (address !== p.address || msat !== p.sats * 1000) throw new LnurlError(`not the confirmed payment (${msat} msat)`, false);
      return p.invoice;
    },
  };
  const store = new InMemoryPayoutStore();
  const service = new PayoutService({
    rails: client,
    resolver: pinned,
    rates: frozen.rates,
    store,
    emit: () => {},
    getPayee: async () => ({ lightningAddress: p.address }),
    customerId: deps.env.BITNOB_PROD_PAYOUT_CUSTOMER_ID?.trim() || undefined,
    maxPayoutSats: p.sats,
    maxAttempts: 1, // one attempt: a confirmed failure ends the run, never a second invoice
    checkDelaysMs: [5_000],
    schedule: () => {},
    now,
    log: { info: (m) => out(m), warn: (m) => out(m), error: (m) => out(m) },
  });
  out(`Paying: reference pay-${bountyId}-1`);
  let row = await service.start({ bountyId, userId: "live-test", amountXof: frozen.amountXof });
  const deadline = now().getTime() + (deps.pollForMs ?? 180_000);
  while (row.status === "processing" && now().getTime() < deadline) {
    await sleep(5_000);
    await service.poll();
    row = (await store.getByBounty(bountyId)) ?? row;
  }
  out("");
  out(`  status          ${row.status}`);
  out(`  reference       pay-${bountyId}-${row.attempts}`);
  out(`  bitnob id       ${row.bitnobPayoutId ?? "none"}`);
  out(`  payment hash    ${row.paymentHash ?? p.invoice.paymentHash}`);
  if (row.preimage) out(`  preimage        ${row.preimage}`);
  if (row.lastError) out(`  last error      ${row.lastError}`);
  if (row.status === "succeeded") {
    out("PAID.");
    return 0;
  }
  if (row.status === "processing") out("Outcome still unknown: check the payment in the Bitnob dashboard. Do NOT run --pay again until you know.");
  return 1;
}

/** CLI entry. */
async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  let args: LivePayArgs;
  let env: Record<string, string>;
  try {
    args = parseArgs(process.argv.slice(2), resolve(repoRoot, ".env.prod"));
    env = readEnvFile(resolve(args.envFile));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const code = await runLivePay(args, {
      env,
      // Explicit creds: never proxy mode, never the dev keys from .env.
      bitnob: (clientId, clientSecret) => new BitnobClient({ clientId, clientSecret, retries: 0 }),
      prompt: (q) => rl.question(q),
      out: (line) => console.log(line),
    });
    process.exitCode = code;
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
