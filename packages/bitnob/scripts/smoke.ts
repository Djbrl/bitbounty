/**
 * F5 sandbox check: whoami + the 4 calls the demo depends on.
 *   pnpm smoke                              (reads BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET from ../../.env)
 *   pnpm smoke --env-file /path/to/.env     (any .env, e.g. the main checkout's from a git worktree)
 * Prints one OK/KO line per call and the raw responses; paste the result in docs/bitnob-api.md.
 * Never prints the secret. Stops after whoami unless it says environment=sandbox (--allow-production to override).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { BitnobClient, BitnobError, readBitnobConfig } from "../src/index.js";

// --env-file <path> | --env-file=<path>: loaded on top of what's already in the environment.
const args = process.argv.slice(2);
const envArg = args.findIndex((a) => a === "--env-file" || a.startsWith("--env-file="));
if (envArg >= 0) {
  const a = args[envArg]!;
  const file = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[envArg + 1];
  if (!file || !existsSync(resolve(file))) {
    console.error(`--env-file: ${file ? `${resolve(file)} not found` : "missing path"}`);
    process.exit(1);
  }
  process.loadEnvFile(resolve(file));
}
const allowProduction = args.includes("--allow-production");

const run = Date.now();
/** Naira sold in the trading quotes. 5000 was more than the sandbox balance. */
const NGN_QUOTE = "1000";
const MAX_DEPOSITS = 5;
const results: { step: string; ok: boolean; note: string }[] = [];

async function step<T>(name: string, fn: () => Promise<T>, note: (r: T) => string): Promise<T | undefined> {
  try {
    const r = await fn();
    results.push({ step: name, ok: true, note: note(r) });
    console.log(`\n--- ${name}: OK\n${JSON.stringify(r, null, 2)}`);
    return r;
  } catch (err) {
    const msg = err instanceof BitnobError ? err.message : String(err);
    results.push({ step: name, ok: false, note: msg });
    console.log(`\n--- ${name}: KO\n${msg}`);
    if (err instanceof BitnobError && err.body) console.log(JSON.stringify(err.body, null, 2));
    return undefined;
  }
}

let client: BitnobClient;
try {
  client = new BitnobClient(readBitnobConfig());
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
}

const me = await step("whoami", () => client.whoami(), (r) => `${r.client_name}, environment=${r.environment}`);
if (!me) {
  console.error("\nwhoami failed: fix the keys before trying the other calls.");
  process.exit(1);
}
if (me.environment !== "sandbox" && !allowProduction) {
  console.error(`\nwhoami says environment=${me.environment}, not sandbox: stopping (pass --allow-production to go on).`);
  process.exit(1);
}

// 1. Lightning invoice (needs a customer).
const payer = await step(
  "customer (payer)",
  () =>
    client.createCustomer({
      email: `bitbounty-payer-${run}@test.invalid`,
      customer_type: "individual",
      first_name: "Awa",
      last_name: "Diop",
      reference: `bb-payer-${run}`,
    }),
  (r) => `id=${r.id}`,
);
if (payer) {
  const inv = await step(
    "1. lightning invoice",
    () =>
      client.createLightningInvoice({
        customer_id: payer.id,
        amount: 1000,
        description: "BitBounty F5 smoke",
        expiry: 900,
        reference: `fund-smoke-${run}`,
      }),
    (r) => `id=${r.id} status=${String(r.status)} bolt11=${String(r.request ?? "").slice(0, 24)}…`,
  );
  if (inv?.id) {
    await step("1b. get lightning invoice", () => client.getLightningInvoice(inv.id), (r) => `status=${String(r.status)}`);
  }
}

// 2. Senegal payout quote (+ the mobile money directory for bank_code).
await step(
  "2a. SN providers",
  () => client.getBanks("SN"),
  (r) => (r.length ? r.map((b) => `${b.bank_name}=${b.bank_code}`).join(", ") : "none listed (sandbox returns banks: null)"),
);
for (const from_asset of ["USDT", "BTC"] as const) {
  await step(
    `2. SN payout quote from ${from_asset}`,
    () =>
      client.createPayoutQuote({
        from_asset,
        to_currency: "XOF",
        country: "SN",
        source: "offchain",
        settlement_amount: "137",
        payment_reason: "bounty",
        reference: `pay-smoke-${from_asset}-${run}`,
      }),
    (r) => `quote_id=${r.quote_id} sends ${r.amount} ${r.from_asset} for ${r.settlement_amount} XOF, fees=${r.fees}, expires ${r.expires_at}`,
  );
}

// 3. Naira virtual account + simulated deposit.
const funder = await step(
  "customer (Lagos funder)",
  () =>
    client.createCustomer({
      email: `bitbounty-lagos-${run}@test.invalid`,
      customer_type: "individual",
      first_name: "Ada",
      last_name: "Okafor",
      phone_number: "+2348012345678",
      country_code: "NGA",
      date_of_birth: "1990-01-01",
      id_type: "bvn",
      id_number: "22222222222",
      reference: `bb-lagos-${run}`,
    }),
  (r) => `id=${r.id}`,
);
if (funder) {
  const va = await step(
    "3a. NGN virtual account",
    () => client.createVirtualAccount({ customer_id: funder.id, currency: "NGN", reference: `va-smoke-${run}` }),
    (r) => `id=${r.id} ${r.bank_name} ${r.account_number}`,
  );
  if (va) {
    // The quotes below sell NGN_QUOTE naira: deposit until the credits cover it (fixed amount per call).
    // The sandbox returns new_balance: "", so we add up the credited amounts ourselves.
    let creditedKobo = 0;
    for (let i = 1; i <= MAX_DEPOSITS && creditedKobo < Number(NGN_QUOTE) * 100; i++) {
      const dep = await step(
        `3. simulate deposit #${i}`,
        () => client.simulateDeposit(va.id),
        (r) =>
          `credited ${r.transaction.amount} kobo (${r.transaction.status}), new_balance ${r.new_balance ? `${r.new_balance} kobo` : "not returned"}`,
      );
      const credited = Number(dep?.transaction.amount);
      if (!dep || !(credited > 0)) break;
      creditedKobo += credited;
    }
  }
}

// 4. Naira → bitcoin quote (and naira → USDT as the fallback route).
for (const quote_currency of ["BTC", "USDT"]) {
  await step(
    `4. NGN→${quote_currency} quote`,
    () => client.createTradingQuote({ base_currency: "NGN", quote_currency, side: "SELL", quantity: NGN_QUOTE }),
    (r) => `id=${r.id} ${r.exchange.send_quantity} ${r.exchange.send_currency} → ${r.exchange.receive_quantity} ${r.exchange.receive_currency}, expires ${r.expires_at}`,
  );
}

console.log("\n=== Summary (paste in docs/bitnob-api.md)\n");
console.log("| Call | Result | Notes |\n| --- | --- | --- |");
for (const r of results) console.log(`| ${r.step} | ${r.ok ? "OK" : "KO"} | ${r.note.replace(/\|/g, "\\|")} |`);
