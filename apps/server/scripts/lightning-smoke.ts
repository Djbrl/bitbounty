/**
 * B1 sandbox check (done-when: "sandbox invoice paid → event emitted"). Run by a HUMAN:
 * paying the invoice is a funds transfer, no agent or CI does it.
 *
 *   pnpm --filter @bitbounty/server lightning:smoke -- 1000
 *
 * 1. Checks the keys are SANDBOX keys (refuses production), creates a Lightning invoice for a
 *    1000 FCFA bounty (+5% fee +3% buffer, in sats) and prints the BOLT11.
 * 2. Pay that BOLT11 from a TESTNET Lightning wallet (the Bitnob sandbox is on testnet; a mainnet
 *    wallet can't pay it). E.g. a testnet faucet wallet such as https://htlc.me, or your own
 *    testnet LND/CLN node (`lncli --network=testnet payinvoice <bolt11>`).
 * 3. The script polls every 3 s and prints `EVENT {"type":"funding.paid",…}` once Bitnob reports the
 *    invoice paid, then exits 0. It exits 1 if the invoice expires first (15 min).
 * Reads Bitnob keys from the repo-root .env.
 */
import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";
import { BitnobFunderCustomers, BitnobRates, InMemoryFundingStore, LightningFunding } from "../src/funding/index.js";

const amountXof = Number(process.argv.slice(2).find((a) => a !== "--") ?? "1000");
const client = new BitnobClient(readBitnobConfig());

const { environment } = await client.whoami();
if (String(environment).toLowerCase() !== "sandbox") {
  console.error(`Refusing: Bitnob environment is "${environment}", not sandbox.`);
  process.exit(2);
}

const store = new InMemoryFundingStore();
let done = false;
const funding = new LightningFunding({
  client,
  store,
  rates: new BitnobRates(client),
  customers: new BitnobFunderCustomers(client),
  emit: (e) => {
    console.log("\nEVENT", JSON.stringify(e));
    done = true;
  },
});

const f = await funding.invoice({ bountyId: `smoke-${Date.now()}`, amountXof, funderId: "smoke" });
console.log(`invoice ${f.bitnobRef}: ${f.sourceAmount} sats for ${f.amountXof} + ${f.feeXof} + ${f.bufferXof} FCFA, expires ${f.expiresAt}`);
console.log("Pay this BOLT11 from a testnet Lightning wallet:");
console.log(f.paymentRequest);
while (!done) {
  await new Promise((r) => setTimeout(r, 3_000));
  await funding.poll().catch((err) => console.error(err));
  const now = await store.get(f.id);
  process.stdout.write(`${now?.status} `);
  if (now?.status === "expired") {
    console.log("\nInvoice expired before payment.");
    process.exit(1);
  }
  // "paid" without EVENT yet means emit failed: the outbox retries on the next poll().
}
process.exit(0);
