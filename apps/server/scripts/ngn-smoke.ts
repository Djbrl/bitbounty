/**
 * B4 sandbox check: Lagos route. Opens a naira account for a bounty, simulates transfers
 * until it's covered, sells the naira for bitcoin and prints the funding.paid event.
 *   pnpm --filter @bitbounty/server ngn:smoke -- 300
 * (300 FCFA → ~₦500 minimum, i.e. a few ₦1,000 simulated deposits.) Reads Bitnob keys from the repo-root .env.
 */
import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";
import { BitnobFunderCustomers, BitnobRates, InMemoryFundingStore, InMemoryNgnAccountStore, NgnFunding } from "../src/funding/index.js";

const amountXof = Number(process.argv.slice(2).find((a) => a !== "--") ?? "300");
const client = new BitnobClient(readBitnobConfig());
const run = Date.now();
const ngn = new NgnFunding({
  client,
  fundings: new InMemoryFundingStore(),
  accounts: new InMemoryNgnAccountStore(),
  rates: new BitnobRates(client),
  customers: new BitnobFunderCustomers(client, () => `lagos-${run}@test.invalid`),
  emit: (e) => console.log("EVENT", JSON.stringify(e)),
  credit: (f, reason) => console.log(`CREDIT funder ${f.funderId}: ${reason}`),
  // Sandbox caps NGN quotes at the company-wide NGN balance (about ₦3,980 on 2026-10-17).
  maxNaira: Number(process.env.NGN_SMOKE_MAX_NAIRA ?? 3_000),
});
const me = await client.whoami();
if (me.environment !== "sandbox") throw new Error(`refusing to run against ${me.environment}`);

const { funding, account } = await ngn.account(
  { bountyId: `smoke-${run}`, amountXof, funderId: "lagos" },
  { first_name: "Ada", last_name: "Okafor", phone_number: "+2348012345678", date_of_birth: "1990-01-01", id_type: "bvn", id_number: "22222222222" },
);
console.log(`naira account ${account.bankName} ${account.accountNumber} (${account.accountName}): send ₦${account.requiredNaira}`);
const done = await ngn.simulateUntilFunded(funding.id);
console.log(`state=${done.state} received=₦${done.receivedKobo / 100} order=${done.orderId ?? "-"} btc=${done.btcReceived ?? "-"}${done.lastError ? ` error=${done.lastError}` : ""}`);
process.exit(0);
